import { InteractionRequiredAuthError, type AccountInfo, type IPublicClientApplication } from "@azure/msal-browser";
import { env } from "../config/env";
import { apiTokenRequest } from "./msal";

/**
 * Obtiene el token para llamar al backend. Solo redirige a Microsoft cuando
 * MSAL pide interacción del usuario; cualquier otro error (red, timeout) se
 * propaga para que la app lo muestre con "Reintentar" en vez de dar otro viaje
 * al login.
 */
export async function getAccessToken(
  instance: Pick<IPublicClientApplication, "acquireTokenSilent" | "acquireTokenRedirect">,
  account: AccountInfo,
): Promise<string | null> {
  const preferAccessToken = Boolean(env.azureApiScope);
  try {
    const result = await instance.acquireTokenSilent({ ...apiTokenRequest, account });
    return preferAccessToken ? result.accessToken || result.idToken : result.idToken || result.accessToken;
  } catch (err) {
    if (!(err instanceof InteractionRequiredAuthError)) throw err;
    await instance.acquireTokenRedirect({
      ...apiTokenRequest,
      account,
      redirectStartPage: `${window.location.origin}/dashboard`,
    });
    return null;
  }
}
