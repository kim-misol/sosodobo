import Foundation
import AuthenticationServices
import Capacitor

/// 시스템 로그인 창 (ASWebAuthenticationSession).
/// 구글은 앱 안 웹뷰에서의 로그인을 막아서, 로그인은 이 창에서 하고 sosodobo://auth?code=… 로 돌아와요.
/// 웹에서: `await Capacitor.Plugins.WebAuth.start({ url, callbackScheme: 'sosodobo' })` → `{ url }` (assets/auth-ui.js)
@objc(WebAuthPlugin)
public class WebAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "WebAuthPlugin"
    public let jsName = "WebAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]

    private var session: ASWebAuthenticationSession?

    @objc func start(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              let scheme = call.getString("callbackScheme") else {
            call.reject("url 과 callbackScheme 이 필요해요.")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                self?.session = nil
                if let callbackURL = callbackURL {
                    call.resolve(["url": callbackURL.absoluteString])
                } else if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                    call.reject("로그인을 취소했어요.", "CANCELLED")
                } else {
                    call.reject(error?.localizedDescription ?? "로그인하지 못했어요.")
                }
            }
            session.presentationContextProvider = self
            // Safari 와 로그인 상태를 같이 써서, 이미 구글에 로그인돼 있으면 비밀번호를 다시 묻지 않아요.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("로그인 창을 열지 못했어요.")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}

/// Capacitor 화면 + 이 앱에만 있는 플러그인 등록 (SceneDelegate 가 씀)
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WebAuthPlugin())
    }
}
