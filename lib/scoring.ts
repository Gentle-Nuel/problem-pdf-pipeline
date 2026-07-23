// Cross-source validation is weighted heavily: a problem seen on multiple
// sources is stronger evidence of real demand than raw engagement on one.
// Starting weights, not measured — revisit once there's enough sales data
// to see what actually predicts a guide selling (see docs/spec.md
// "Pricing strategy" on feeding sales data back into scoring later).
export function computeScore(sourceCount: number, totalEngagement: number): number {
  return sourceCount * 100 + totalEngagement;
}
