import { useEffect, useRef } from "react";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const SCRIPT_ID = "google-gsi-script";

let gisLoading = null;

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (gisLoading) return gisLoading;

  gisLoading = new Promise((resolve, reject) => {
    const script = document.getElementById(SCRIPT_ID) || document.createElement("script");
    script.addEventListener("load", () =>
      window.google?.accounts?.id
        ? resolve(window.google.accounts.id)
        : reject(new Error("Google sign-in is unavailable.")),
    );
    script.addEventListener("error", () => reject(new Error("Could not load Google sign-in.")));
    if (!script.id) {
      script.id = SCRIPT_ID;
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    gisLoading = null;
    throw error;
  });

  return gisLoading;
}

function googleClientId() {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
}

export function GoogleSignInButton({ onCredential, onError }) {
  const container = useRef(null);
  const handlers = useRef({ onCredential, onError });
  const clientId = googleClientId();

  useEffect(() => {
    handlers.current = { onCredential, onError };
  }, [onCredential, onError]);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;

    loadGoogleIdentity()
      .then((identity) => {
        if (cancelled || !container.current) return;
        identity.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response?.credential) handlers.current.onCredential(response.credential);
            else handlers.current.onError("Google sign-in was cancelled or failed.");
          },
          ux_mode: "popup",
        });
        container.current.replaceChildren();
        identity.renderButton(container.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "rectangular",
          logo_alignment: "center",
          width: Math.min(400, container.current.offsetWidth || 320),
        });
      })
      .catch((error) => {
        if (!cancelled) handlers.current.onError(error.message);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!clientId) return null;

  return <div ref={container} className="flex min-h-11 w-full justify-center" data-testid="google-sign-in" />;
}
