export type AccountMenuAuthActions = {
  showLogin: boolean;
  showAccount: boolean;
  showLogout: boolean;
};

/**
 * Chip/menu auth. Trial/embedded wallets stay local-by-default — only phone/email
 * login counts as cloud signed-in. Never pair 「登录」 with 「退出登录」.
 */
export function resolveAccountMenuAuthActions(input: {
  signedIn: boolean;
  embedded?: boolean;
}): AccountMenuAuthActions {
  const cloudSignedIn = Boolean(input.signedIn) && !input.embedded;
  if (!cloudSignedIn) {
    return { showLogin: true, showAccount: false, showLogout: false };
  }
  return { showLogin: false, showAccount: true, showLogout: true };
}
