import type { CurrentAccount } from "@/product/apiClient";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";
export type HeaderMenuItem = "dashboard" | "mypage" | "logout" | "login" | "signup" | "loading";

export function getDashboardPath(role: CurrentAccount["role"] | undefined | null) {
  if (role === "BRAND") return "/brand";
  if (role === "CREATOR") return "/creator";
  return null;
}

export function getMyPagePath(role: CurrentAccount["role"] | undefined | null) {
  if (role === "BRAND") return "/brand/me";
  if (role === "CREATOR") return "/creator/me";
  return "/signup";
}

export function postLoginPath(
  account: CurrentAccount,
  dashboardTarget: string,
  redirect: string | null,
) {
  if (account.onboardingStatus !== "COMPLETED") return dashboardTarget;
  const dashboardPath = getDashboardPath(account.role) ?? dashboardTarget;
  if (!redirect) return dashboardPath;
  if (redirect === "/brand/promotions/new" || redirect === "/brand/products/new") return dashboardPath;
  if (account.role === "BRAND" && redirect.startsWith("/brand/")) return redirect;
  if (account.role === "CREATOR" && redirect.startsWith("/creator/")) return redirect;
  return dashboardPath;
}

export function headerMenuForAuth(
  status: AuthStatus,
  role?: CurrentAccount["role"] | null,
): HeaderMenuItem[] {
  if (status === "loading") return ["loading"];
  if (status === "authenticated") {
    return role ? ["dashboard", "mypage", "logout"] : ["mypage", "logout"];
  }
  return ["login", "signup"];
}

// Pages inside this shell get the persistent Sidebar; TopBar drops its own
// dashboard/mypage links there so the two navs don't repeat each other.
export function isDashboardShellPath(pathname: string) {
  return /^\/(brand|creator)(\/|$)/.test(pathname) && !/\/(onboarding|result|connect|rules)(\/|$)/.test(pathname);
}

export function safeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value.startsWith("/api/")) return null;
  return value;
}
