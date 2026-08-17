/**
 * Enhanced opencode-scheduler supervisor used by WodeAppX automations.
 *
 * Stock supervisor does not inject WODEAPP_API_KEY. After provider configs moved
 * to `{env:WODEAPP_API_KEY}`, launchd runs authenticate as guests and fail with
 * AUTH_REQUIRED. Resolve the active desktop key from ~/.wodeapp/config.json at
 * run time so job JSON never stores the secret and key rotation stays live.
 */
export const WODEAPPX_SCHEDULER_SUPERVISOR_MARKER = "wodeappx-supervisor-auth-v1";

export const WODEAPPX_SCHEDULER_SUPERVISOR_SCRIPT = `#!/usr/bin/perl
use strict;
use warnings;
use JSON::PP;
use File::Basename qw(dirname);
use File::Path qw(make_path);
use POSIX qw(setsid strftime);
use Time::HiRes qw(time);

# opencode-scheduler supervisor v1
# ${WODEAPPX_SCHEDULER_SUPERVISOR_MARKER}

sub iso_now {
  my @t = localtime(time());
  return strftime("%Y-%m-%dT%H:%M:%S%z", @t);
}

sub read_json {
  my ($path) = @_;
  open my $fh, "<", $path or die "Failed to read $path: $!
";
  local $/;
  my $raw = <$fh>;
  close $fh;
  my $json = JSON::PP->new->utf8->relaxed;
  return $json->decode($raw);
}

sub write_json_atomic {
  my ($path, $data) = @_;
  my $tmp = "$path.tmp.$$";
  my $json = JSON::PP->new->utf8->canonical;
  open my $fh, ">", $tmp or die "Failed to write $tmp: $!
";
  print $fh $json->encode($data);
  close $fh or die "Failed to close $tmp: $!
";
  rename $tmp, $path or die "Failed to rename $tmp -> $path: $!
";
}

sub append_jsonl {
  my ($path, $data) = @_;
  my $json = JSON::PP->new->utf8->canonical;
  open my $fh, ">>", $path or die "Failed to append $path: $!
";
  print $fh $json->encode($data) . "
";
  close $fh;
}

sub pid_alive {
  my ($pid) = @_;
  return 0 if !$pid;
  return kill 0, $pid;
}

sub random_id {
  my $n = int(rand(1_000_000_000));
  return sprintf("%09d", $n);
}

sub resolve_wodeapp_api_key {
  my ($home, $inv) = @_;
  if (defined $ENV{WODEAPP_API_KEY} && $ENV{WODEAPP_API_KEY} =~ /\\S/) {
    my $key = $ENV{WODEAPP_API_KEY};
    $key =~ s/^\\s+|\\s+$//g;
    return $key if length($key);
  }
  if ($inv && ref($inv) eq "HASH" && ref($inv->{args}) eq "ARRAY") {
    for my $arg (@{$inv->{args}}) {
      next unless defined $arg && !ref($arg);
      if ($arg =~ /^WODEAPP_API_KEY=(.*)$/) {
        my $key = $1;
        $key =~ s/^\\s+|\\s+$//g;
        return $key if length($key);
      }
    }
  }
  my $config_path = "$home/.wodeapp/config.json";
  if (-f $config_path) {
    my $config = eval { read_json($config_path) };
    if ($config && ref($config) eq "HASH" && defined $config->{apiKey} && !ref($config->{apiKey})) {
      my $key = $config->{apiKey};
      $key =~ s/^\\s+|\\s+$//g;
      return $key if length($key);
    }
  }
  return undef;
}

my $job_path = shift @ARGV;
if (!$job_path) { die "usage: supervisor.pl <job.json>
"; }

my $job = read_json($job_path);
my $scope_id = $job->{scopeId} || "";
my $slug = $job->{slug} || "";
if (!$scope_id || !$slug) { die "job missing scopeId/slug
"; }

my $home = $ENV{HOME} || "";
if (!$home) { die "HOME is not set
"; }

my $config_root = "$home/.config/opencode";
my $scheduler_root = "$config_root/scheduler/scopes/$scope_id";
my $locks_dir = "$scheduler_root/locks";
my $runs_dir = "$scheduler_root/runs";
my $logs_dir = "$config_root/logs/scheduler/$scope_id";

make_path($locks_dir);
make_path($runs_dir);
make_path($logs_dir);

my $log_path = "$logs_dir/$slug.log";
open STDOUT, ">>", $log_path or die "Failed to open log $log_path: $!
";
open STDERR, ">&STDOUT" or die "Failed to dup stderr: $!
";
select STDOUT; $| = 1;
select STDERR; $| = 1;

my $lock_path = "$locks_dir/$slug.json";
if (-e $lock_path) {
  my $lock = eval { read_json($lock_path) };
  my $pid = ($lock && ref($lock) eq 'HASH') ? ($lock->{pid} || 0) : 0;
  if (pid_alive($pid)) {
    my $now = iso_now();
    print "
=== Scheduled run skipped (already running pid=$pid) $now ===
";
    exit 0;
  }
  unlink $lock_path;
}

my $run_id = time() . "-" . random_id();
my $started_at = iso_now();
my $t0 = time();

write_json_atomic($lock_path, { pid => $$, startedAt => $started_at, runId => $run_id });

# Update job metadata: running
$job->{lastRunAt} = $started_at;
$job->{lastRunSource} = "scheduled";
$job->{lastRunStatus} = "running";
delete $job->{lastRunExitCode};
delete $job->{lastRunError};
$job->{updatedAt} = $started_at;
write_json_atomic($job_path, $job);

# Force non-interactive scheduled runs
my $perm = { question => "deny" };
if ($ENV{OPENCODE_PERMISSION}) {
  my $existing = eval { JSON::PP->new->decode($ENV{OPENCODE_PERMISSION}) };
  if ($existing && ref($existing) eq 'HASH') {
    $perm = { %$existing, %$perm };
  }
}
$ENV{OPENCODE_PERMISSION} = JSON::PP->new->canonical->encode($perm);
$ENV{OPENCODE_SCHEDULER_RUN_ID} = $run_id;

print "
=== Scheduled run $started_at runId=$run_id ===
";

my $inv = $job->{invocation};
if (!$inv || ref($inv) ne 'HASH' || !$inv->{command} || ref($inv->{args}) ne 'ARRAY') {
  my $now = iso_now();
  print "
=== Supervisor error $now: job missing invocation.command/args ===
";
  $job->{lastRunStatus} = "failed";
  $job->{lastRunError} = "job missing invocation";
  $job->{updatedAt} = $now;
  write_json_atomic($job_path, $job);
  unlink $lock_path;
  exit 1;
}

my $wodeapp_api_key = resolve_wodeapp_api_key($home, $inv);
if (defined $wodeapp_api_key) {
  $ENV{WODEAPP_API_KEY} = $wodeapp_api_key;
} else {
  print "
=== Supervisor warning: WODEAPP_API_KEY unresolved; chat may return AUTH_REQUIRED ===
";
}

my $command = $inv->{command};
my @args = @{ $inv->{args} };

my $workdir = $job->{workdir} || $home;

my $timeout = $job->{timeoutSeconds};
$timeout = undef if defined($timeout) && $timeout !~ /^\\d+$/;

my $timed_out = 0;
my $child_pid = fork();
if (!defined $child_pid) {
  my $now = iso_now();
  print "
=== Supervisor error $now: fork failed: $! ===
";
  $job->{lastRunStatus} = "failed";
  $job->{lastRunError} = "fork failed";
  $job->{updatedAt} = $now;
  write_json_atomic($job_path, $job);
  unlink $lock_path;
  exit 1;
}

if ($child_pid == 0) {
  chdir $workdir or die "Failed to chdir to $workdir: $!
";
  eval { setsid(); };
  exec { $command } $command, @args;
  die "Failed to exec $command: $!
";
}

if (defined($timeout) && $timeout > 0) {
  local $SIG{ALRM} = sub {
    $timed_out = 1;
    my $now = iso_now();
    print "
=== Timeout after $timeout seconds $now; sending SIGTERM ===
";
    kill 'TERM', -$child_pid;
    sleep 5;
    print "
=== Forcing SIGKILL $now ===
";
    kill 'KILL', -$child_pid;
  };
  alarm($timeout);
}

my $waited = waitpid($child_pid, 0);
my $status = $?;
alarm(0);

my $finished_at = iso_now();
my $duration_ms = int((time() - $t0) * 1000);
my $exit_code = ($status >> 8);
if ($timed_out) {
  $exit_code = 124;
}

my $final_status = "failed";
my $final_error = undef;
if ($timed_out) {
  $final_status = "failed";
  $final_error = "timeout";
} elsif ($waited != $child_pid) {
  $final_status = "failed";
  $final_error = "waitpid failed";
} elsif ($status == 0) {
  $final_status = "success";
} else {
  $final_status = "failed";
  $final_error = "exit code $exit_code";
}

$job->{lastRunStatus} = $final_status;
$job->{lastRunExitCode} = $exit_code;
$job->{lastRunError} = $final_error if defined $final_error;
$job->{updatedAt} = $finished_at;
write_json_atomic($job_path, $job);

append_jsonl("$runs_dir/$slug.jsonl", {
  runId => $run_id,
  scopeId => $scope_id,
  slug => $slug,
  startedAt => $started_at,
  finishedAt => $finished_at,
  durationMs => $duration_ms,
  status => $final_status,
  exitCode => $exit_code,
  error => $final_error,
  pid => $child_pid,
  logPath => $log_path,
});

unlink $lock_path;
print "
=== Finished $finished_at status=$final_status exitCode=$exit_code durationMs=$duration_ms ===
";
exit($exit_code);
`;
