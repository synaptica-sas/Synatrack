import { PublicClientApplication, type Configuration } from "@azure/msal-browser";
import { env } from "../config/env";

const msalConfig: Configuration = {
  auth: {
    clientId: env.azureClientId,
    authority: `https://login.microsoftonline.com/${env.azureTenantId || "common"}`,
    redirectUri: env.azureRedirectUri,
  },
  cache: {
    cacheLocation: "localStorage",
  },
};

export const loginRequest = {
  // Con el scope de la API en el login, el token queda en caché y
  // `acquireTokenSilent` no necesita ir a la red al volver del redirect.
  scopes: ["openid", "profile", "email", ...(env.azureApiScope ? [env.azureApiScope] : [])],
};

export const apiTokenRequest = {
  scopes: [env.azureApiScope || "User.Read"],
};

export const msalInstance = new PublicClientApplication(msalConfig);
