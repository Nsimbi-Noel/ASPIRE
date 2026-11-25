export { COOKIE_NAME } from "@shared/const";

/** Sends the browser to the sign-in page (once, so redirects cannot loop). */
export const goToLogin = () => {
  if (typeof window !== "undefined" && window.location.pathname !== "/login") window.location.assign("/login");
};
