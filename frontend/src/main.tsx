import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MsalProvider } from "@azure/msal-react";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { msalInstance } from "./auth/msal";

async function bootstrapApp() {
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
