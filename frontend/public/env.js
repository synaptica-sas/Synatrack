// Configuración en runtime para el servidor propio (`server.mjs`, usado por Docker),
// que reemplaza este archivo por uno con los valores reales. En Azure Static Web Apps
// se sirve tal cual (vacío): ahí la configuración son las VITE_* fijadas en el build.
window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};
