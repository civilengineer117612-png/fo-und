// P0-6 PR 4: the EXACT figures the goal window must show for the Emergency Fund, with invented budgets:
// Rent 20,000.00 (Fixed by its role) and Food 8,000.00 (a Need): 3 x (8,000.00 + 20,000.00) = 84,000.00. Shared by e2e/run.mjs and the mutation check.
export const EF_RULES = [["cat-rent", 2000000], ["cat-food", 800000]];   // centavos
const WORDS = "3 × \\(Food ₱8,000\\.00 \\+ Rent ₱20,000\\.00\\) = 3 × ₱28,000\\.00";
export const EF_EXPECT = {
  // a figure the owner typed (999) wins and is called "your figure"; the formula is only mentioned
  typedTarget: /Target\s*₱999\.00\s*·\s*your figure/,
  typedNote: new RegExp("Your figure, used everywhere\\. The formula would give ₱84,000\\.00: " + WORDS),
  // with no typed figure the target IS the formula
  formulaTarget: /Target\s*₱84,000\.00\s*·\s*formula/,
  formulaNote: new RegExp("Target = " + WORDS + " = ₱84,000\\.00"),
};
