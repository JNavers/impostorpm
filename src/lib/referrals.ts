/**
 * Roles the community is helping to fill through referrals.
 *
 * Each entry becomes /refer/<slug>. The slug must also be listed in ROLES in
 * functions/api/referral.js, which is the whitelist the endpoint checks: the
 * Function is bundled separately and cannot import from src/, and a role the
 * endpoint does not know about is rejected rather than emailed blind.
 */
export type ReferralRole = {
  slug: string;
  company: string;
  companyBlurb: string;
  title: string;
  lede: string;
  requirements: { title: string; body: string }[];
  seniority: string;
  location: string;
};

export const REFERRAL_ROLES: ReferralRole[] = [
  {
    slug: 'condukt-product',
    company: 'Condukt',
    companyBlurb:
      'Condukt uses real-time data and AI to automate business compliance checks for financial institutions, with teams in London and Porto.',
    title: 'Product role at Condukt',
    lede: "Condukt is looking for a fairly specific Product person, and we think someone in the community already knows them.",
    requirements: [
      { title: 'Product experience', body: '3+ years in Product, working as PO or PM.' },
      { title: 'A strong technical background', body: 'Ideally with a degree in Engineering or IT.' },
      { title: 'Technical products', body: 'Especially infrastructure or API-first products.' },
    ],
    seniority: 'Mid to Senior',
    location: 'Available to be at the Porto office 2+ days a week',
  },
];
