import type { Role } from "./types";

export const appRoutes = [
  "/",
  "/login",
  "/signup",
  "/signup/brand",
  "/signup/creator",
  "/brand",
  "/brand/onboarding",
  "/brand/promotions",
  "/brand/promotions/new",
  "/brand/promotions/[promotionId]",
  "/brand/negotiations/[negotiationId]",
  "/brand/agreements/[agreementId]",
  "/brand/campaign",
  "/brand/products/new",
  "/brand/negotiate",
  "/brand/result",
  "/brand/settlement",
  "/brand/me",
  "/brand/settings",
  "/creator",
  "/creator/onboarding",
  "/creator/offers",
  "/creator/offers/[negotiationId]",
  "/creator/criteria",
  "/creator/result",
  "/creator/agreements",
  "/creator/agreements/[agreementId]",
  "/creator/settlements",
  "/creator/me",
  "/creator/settings",
  "/dev/admin",
] as const;

export function roleHome(role: Role) {
  return `/${role}`;
}

export function roleNegotiation(role: Role) {
  return role === "brand" ? "/brand/negotiate" : "/creator/result";
}

export function roleResult(role: Role) {
  return `/${role}/result`;
}

export const brandWorkspaceRoutes = [
  { href: "/brand", label: "Dashboard" },
  { href: "/brand/promotions", label: "Promotions" },
  { href: "/brand/promotions", label: "Negotiations" },
  { href: "/brand/promotions", label: "Agreements" },
] as const;

export const creatorWorkspaceRoutes = [
  { href: "/creator", label: "Dashboard" },
  { href: "/creator/criteria", label: "Criteria" },
  { href: "/creator/offers", label: "Offers" },
  { href: "/creator/agreements", label: "Agreements" },
  { href: "/creator/settlements", label: "Settlements" },
] as const;

export const accountRoutes = [
  { href: "/brand/me", label: "Brand My" },
  { href: "/brand/settings", label: "Brand Settings" },
  { href: "/creator/me", label: "Creator My" },
  { href: "/creator/settings", label: "Creator Settings" },
] as const;
