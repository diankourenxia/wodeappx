package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/elazarl/goproxy"
)

const version = "0.1.0"

type headerMap map[string][]string

type resourceEvent struct {
	Type            string    `json:"type"`
	URL             string    `json:"url"`
	Method          string    `json:"method"`
	StatusCode      int       `json:"statusCode"`
	ResponseHeaders headerMap `json:"responseHeaders,omitempty"`
	RequestHeaders  headerMap `json:"requestHeaders,omitempty"`
	Referrer        string    `json:"referrer,omitempty"`
	ResourceType    string    `json:"resourceType,omitempty"`
	SizeBytes       int64     `json:"sizeBytes,omitempty"`
}

type emitter struct {
	mu      sync.Mutex
	encoder *json.Encoder
}

func newEmitter() *emitter {
	return &emitter{encoder: json.NewEncoder(os.Stdout)}
}

func (e *emitter) emit(value any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.encoder.Encode(value); err != nil {
		log.Printf("failed to emit capture event: %v", err)
	}
}

type captureProxy struct {
	seen    map[string]struct{}
	seenMu  sync.Mutex
	rules   *ruleSet
	emitter *emitter
}

func newCaptureProxy(rules *ruleSet, emitter *emitter) *captureProxy {
	return &captureProxy{
		seen:    make(map[string]struct{}),
		rules:   rules,
		emitter: emitter,
	}
}

func (p *captureProxy) shouldEmit(key string) bool {
	p.seenMu.Lock()
	defer p.seenMu.Unlock()
	if _, ok := p.seen[key]; ok {
		return false
	}
	p.seen[key] = struct{}{}
	return true
}

func (p *captureProxy) handleConnect(host string, ctx *goproxy.ProxyCtx) (*goproxy.ConnectAction, string) {
	if p.rules.shouldMitm(host) {
		return goproxy.MitmConnect, host
	}
	return goproxy.OkConnect, host
}

func (p *captureProxy) handleResponse(resp *http.Response, ctx *goproxy.ProxyCtx) *http.Response {
	if resp == nil || resp.Request == nil {
		return resp
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return resp
	}

	rawURL := resp.Request.URL.String()
	contentType := resp.Header.Get("Content-Type")
	kind := classifyResource(contentType, extensionFromURL(rawURL))
	if kind == "" {
		return resp
	}

	method := resp.Request.Method
	if method == "" {
		method = http.MethodGet
	}
	key := method + ":" + rawURL
	if !p.shouldEmit(key) {
		return resp
	}

	referrer := resp.Request.Header.Get("Referer")
	if referrer == "" {
		referrer = resp.Request.Header.Get("Referrer")
	}

	p.emitter.emit(resourceEvent{
		Type:            "resource",
		URL:             rawURL,
		Method:          method,
		StatusCode:      resp.StatusCode,
		ResponseHeaders: cloneHeaders(resp.Header),
		RequestHeaders:  cloneHeaders(resp.Request.Header),
		Referrer:        referrer,
		ResourceType:    kind,
		SizeBytes:       responseSize(resp),
	})
	return resp
}

func cloneHeaders(headers http.Header) headerMap {
	result := make(headerMap, len(headers))
	for key, values := range headers {
		copied := make([]string, len(values))
		copy(copied, values)
		result[key] = copied
	}
	return result
}

func responseSize(resp *http.Response) int64 {
	if resp.ContentLength > 0 {
		return resp.ContentLength
	}
	if raw := resp.Header.Get("Content-Length"); raw != "" {
		if parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64); err == nil && parsed > 0 {
			return parsed
		}
	}
	if raw := resp.Header.Get("Content-Range"); raw != "" {
		parts := strings.Split(raw, "/")
		if len(parts) == 2 {
			if parsed, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64); err == nil && parsed > 0 {
				return parsed
			}
		}
	}
	return 0
}

func extensionFromURL(rawURL string) string {
	beforeQuery := strings.Split(strings.Split(rawURL, "?")[0], "#")[0]
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(beforeQuery)), ".")
	return strings.Trim(ext, " \t\r\n")
}

func classifyResource(contentType string, extension string) string {
	mime := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if kind := kindByMime[mime]; kind != "" {
		return kind
	}
	if kind := kindByExtension[strings.ToLower(extension)]; kind != "" {
		return kind
	}
	if strings.HasPrefix(mime, "image/") {
		return "image"
	}
	if strings.HasPrefix(mime, "video/") {
		return "video"
	}
	if strings.HasPrefix(mime, "audio/") {
		return "audio"
	}
	if strings.Contains(mime, "mpegurl") || strings.Contains(mime, "dash+xml") {
		return "video"
	}
	if strings.Contains(mime, "json") {
		return "json"
	}
	return ""
}

var kindByMime = map[string]string{
	"image/png":                     "image",
	"image/webp":                    "image",
	"image/jpeg":                    "image",
	"image/jpg":                     "image",
	"image/gif":                     "image",
	"image/avif":                    "image",
	"image/bmp":                     "image",
	"image/tiff":                    "image",
	"image/heic":                    "image",
	"image/x-icon":                  "image",
	"image/svg+xml":                 "image",
	"image/apng":                    "image",
	"audio/mpeg":                    "audio",
	"audio/mp3":                     "audio",
	"audio/wav":                     "audio",
	"audio/aiff":                    "audio",
	"audio/x-aiff":                  "audio",
	"audio/aac":                     "audio",
	"audio/ogg":                     "audio",
	"audio/flac":                    "audio",
	"audio/midi":                    "audio",
	"audio/x-midi":                  "audio",
	"audio/x-ms-wma":                "audio",
	"audio/opus":                    "audio",
	"audio/webm":                    "audio",
	"audio/mp4":                     "audio",
	"audio/amr":                     "audio",
	"video/mp4":                     "video",
	"video/webm":                    "video",
	"video/ogg":                     "video",
	"video/x-msvideo":               "video",
	"video/mpeg":                    "video",
	"video/quicktime":               "video",
	"video/x-ms-wmv":                "video",
	"video/3gpp":                    "video",
	"video/x-matroska":              "video",
	"video/x-flv":                   "video",
	"application/dash+xml":          "video",
	"application/vnd.apple.mpegurl": "video",
	"application/x-mpegurl":         "video",
	"application/x-mpeg":            "video",
	"audio/x-mpegurl":               "video",
	"application/json":              "json",
	"text/json":                     "json",
}

var kindByExtension = map[string]string{
	"apng": "image",
	"avif": "image",
	"bmp":  "image",
	"gif":  "image",
	"heic": "image",
	"jpeg": "image",
	"jpg":  "image",
	"png":  "image",
	"svg":  "image",
	"tif":  "image",
	"tiff": "image",
	"webp": "image",
	"aac":  "audio",
	"amr":  "audio",
	"aiff": "audio",
	"flac": "audio",
	"m4a":  "audio",
	"mid":  "audio",
	"midi": "audio",
	"mp3":  "audio",
	"oga":  "audio",
	"ogg":  "audio",
	"opus": "audio",
	"wav":  "audio",
	"weba": "audio",
	"wma":  "audio",
	"3gp":  "video",
	"avi":  "video",
	"flv":  "video",
	"m3u8": "video",
	"m4v":  "video",
	"mkv":  "video",
	"mov":  "video",
	"mp4":  "video",
	"mpd":  "video",
	"mpeg": "video",
	"mpg":  "video",
	"ogv":  "video",
	"ts":   "video",
	"webm": "video",
	"wmv":  "video",
	"json": "json",
}

type rule struct {
	isNeg      bool
	isAll      bool
	isWildcard bool
	domain     string
}

type ruleSet struct {
	rules []rule
}

func parseRules(raw string) *ruleSet {
	lines := strings.Split(raw, "\n")
	rules := make([]rule, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		isNeg := false
		if strings.HasPrefix(line, "!") {
			isNeg = true
			line = strings.TrimSpace(strings.TrimPrefix(line, "!"))
		}
		if line == "" {
			continue
		}
		if line == "*" {
			rules = append(rules, rule{isAll: true, isNeg: isNeg})
			continue
		}
		isWildcard := strings.HasPrefix(line, "*.")
		domain := strings.TrimPrefix(line, "*.")
		rules = append(rules, rule{
			isNeg:      isNeg,
			isWildcard: isWildcard,
			domain:     strings.ToLower(domain),
		})
	}
	if len(rules) == 0 {
		rules = append(rules, rule{isAll: true})
	}
	return &ruleSet{rules: rules}
}

func (r *ruleSet) shouldMitm(host string) bool {
	h := host
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		h = parsedHost
	}
	h = strings.ToLower(strings.Trim(h, "[]"))

	action := false
	for _, current := range r.rules {
		if current.isAll {
			action = !current.isNeg
			continue
		}
		if current.isWildcard {
			if h == current.domain || strings.HasSuffix(h, "."+current.domain) {
				action = !current.isNeg
			}
			continue
		}
		if h == current.domain {
			action = !current.isNeg
		}
	}
	return action
}

type caPaths struct {
	CertPEM string
	CertDER string
	KeyPEM  string
}

func ensureCA(dir string) (tls.Certificate, caPaths, error) {
	paths := caPaths{
		CertPEM: filepath.Join(dir, "wodeappx-capture-ca.pem"),
		CertDER: filepath.Join(dir, "wodeappx-capture-ca.cer"),
		KeyPEM:  filepath.Join(dir, "wodeappx-capture-ca-key.pem"),
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return tls.Certificate{}, paths, err
	}

	certPEM, certErr := os.ReadFile(paths.CertPEM)
	keyPEM, keyErr := os.ReadFile(paths.KeyPEM)
	if certErr == nil && keyErr == nil {
		cert, err := tls.X509KeyPair(certPEM, keyPEM)
		if err != nil {
			return tls.Certificate{}, paths, err
		}
		if cert.Leaf, err = x509.ParseCertificate(cert.Certificate[0]); err != nil {
			return tls.Certificate{}, paths, err
		}
		_ = os.WriteFile(paths.CertDER, cert.Leaf.Raw, 0o644)
		return cert, paths, nil
	}

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return tls.Certificate{}, paths, err
	}
	serialLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serialNumber, err := rand.Int(rand.Reader, serialLimit)
	if err != nil {
		return tls.Certificate{}, paths, err
	}
	template := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName:   "我的AppX Local Capture CA",
			Organization: []string{"我的AppX"},
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature | x509.KeyUsageCRLSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLenZero:        true,
	}
	derBytes, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		return tls.Certificate{}, paths, err
	}

	certPEMBlock := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	keyPEMBlock := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)})
	if err := os.WriteFile(paths.CertPEM, certPEMBlock, 0o644); err != nil {
		return tls.Certificate{}, paths, err
	}
	if err := os.WriteFile(paths.CertDER, derBytes, 0o644); err != nil {
		return tls.Certificate{}, paths, err
	}
	if err := os.WriteFile(paths.KeyPEM, keyPEMBlock, 0o600); err != nil {
		return tls.Certificate{}, paths, err
	}

	cert, err := tls.X509KeyPair(certPEMBlock, keyPEMBlock)
	if err != nil {
		return tls.Certificate{}, paths, err
	}
	if cert.Leaf, err = x509.ParseCertificate(cert.Certificate[0]); err != nil {
		return tls.Certificate{}, paths, err
	}
	return cert, paths, nil
}

func installCAForGoproxy(ca tls.Certificate) {
	goproxy.GoproxyCa = ca
	goproxy.OkConnect = &goproxy.ConnectAction{Action: goproxy.ConnectAccept, TLSConfig: goproxy.TLSConfigFromCA(&ca)}
	goproxy.MitmConnect = &goproxy.ConnectAction{Action: goproxy.ConnectMitm, TLSConfig: goproxy.TLSConfigFromCA(&ca)}
	goproxy.HTTPMitmConnect = &goproxy.ConnectAction{Action: goproxy.ConnectHTTPMitm, TLSConfig: goproxy.TLSConfigFromCA(&ca)}
	goproxy.RejectConnect = &goproxy.ConnectAction{Action: goproxy.ConnectReject, TLSConfig: goproxy.TLSConfigFromCA(&ca)}
}

func main() {
	host := flag.String("host", "127.0.0.1", "proxy listen host")
	port := flag.Int("port", 8899, "proxy listen port")
	caDir := flag.String("ca-dir", ".", "directory for local capture CA")
	ruleText := flag.String("rule", "*", "MITM host rules, one per line")
	upstream := flag.String("upstream", "", "optional upstream HTTP proxy URL")
	showVersion := flag.Bool("version", false, "print version")
	flag.Parse()

	if *showVersion {
		fmt.Printf("wodeappx-capture-engine %s\n", version)
		return
	}

	log.SetOutput(os.Stderr)
	emitter := newEmitter()

	ca, paths, err := ensureCA(*caDir)
	if err != nil {
		emitter.emit(map[string]any{"type": "error", "message": "failed to prepare capture CA: " + err.Error()})
		os.Exit(1)
	}
	installCAForGoproxy(ca)

	capture := newCaptureProxy(parseRules(*ruleText), emitter)
	proxy := goproxy.NewProxyHttpServer()
	proxy.Verbose = false
	proxy.Logger = log.New(os.Stderr, "wodeappx-capture-engine ", log.LstdFlags)
	if strings.TrimSpace(*upstream) != "" {
		upstreamURL, err := url.Parse(strings.TrimSpace(*upstream))
		if err != nil {
			emitter.emit(map[string]any{"type": "error", "message": "invalid upstream proxy: " + err.Error()})
			os.Exit(1)
		}
		proxy.Tr = &http.Transport{
			Proxy:                 http.ProxyURL(upstreamURL),
			DisableKeepAlives:     false,
			TLSHandshakeTimeout:   60 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
			IdleConnTimeout:       30 * time.Second,
		}
		proxy.ConnectDial = proxy.NewConnectDialToProxy(upstreamURL.String())
	}
	proxy.OnRequest().HandleConnectFunc(capture.handleConnect)
	proxy.OnResponse().DoFunc(capture.handleResponse)

	address := net.JoinHostPort(*host, strconv.Itoa(*port))
	listener, err := net.Listen("tcp", address)
	if err != nil {
		emitter.emit(map[string]any{"type": "error", "message": "failed to listen: " + err.Error()})
		os.Exit(1)
	}

	server := &http.Server{Handler: proxy, ReadHeaderTimeout: 30 * time.Second}
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			emitter.emit(map[string]any{"type": "error", "message": "proxy server stopped: " + err.Error()})
		}
	}()

	emitter.emit(map[string]any{
		"type":      "state",
		"status":    "listening",
		"host":      *host,
		"port":      *port,
		"caPath":    paths.CertDER,
		"caPemPath": paths.CertPEM,
		"engine":    "wodeappx-capture-engine",
		"version":   version,
	})

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	<-signals

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
	<-done
	emitter.emit(map[string]any{"type": "state", "status": "stopped"})
}
