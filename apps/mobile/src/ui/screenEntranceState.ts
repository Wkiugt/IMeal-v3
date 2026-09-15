export function shouldAnimateScreenEntrance(
  active: boolean,
  hasEntered: boolean,
): boolean {
  return active && !hasEntered;
}
