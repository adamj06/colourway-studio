// A fixed locale, so the prerendered page does not depend on the machine that built it.
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const count = new Intl.NumberFormat('en-US');

export const formatUsd = (value: number): string => usd.format(value);
export const formatCount = (value: number): string => count.format(value);
