import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MsalProvider } from "@azure/msal-react";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { msalInstance } from "./auth/msal";
import { REDIRECT_ERROR_MESSAGE, setRedirectError } from "./auth/redirectError";

async function bootstrapApp() {
  // Si MSAL falla al iniciar o al procesar el redirect, la app se pinta igual
  // y la pantalla de login muestra el error con opción de reintentar.
  try {
    await msalInstance.initialize();

    const redirectResult = await msalInstance.handleRedirectPromise();
    if (redirectResult?.account) {
      msalInstance.setActiveAccount(redirectResult.account);
    } else {
      const activeAccount = msalInstance.getActiveAccount();
      if (!activeAccount) {
        const allAccounts = msalInstance.getAllAccounts();
        if (allAccounts[0]) {
          msalInstance.setActiveAccount(allAccounts[0]);
        }
      }
    }
  } catch (err) {
    // En pantalla va un mensaje genérico; el motivo real (código de MSAL/Entra)
    // queda en la consola para poder diagnosticarlo.
    console.error("[MSAL] Falló el inicio de sesión al volver de Microsoft", err);
    setRedirectError(REDIRECT_ERROR_MESSAGE);
  }

  if (window.location.hash.includes("code=") || window.location.hash.includes("id_token=")) {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <MsalProvider instance={msalInstance}>
          <App />
        </MsalProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void bootstrapApp();
