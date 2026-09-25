/**
 * Roles the community is helping to fill through referrals.
 *
 * Each entry becomes /talent/<slug>. The slug must also be listed in ROLES in
 * functions/api/talent.js, which is the whitelist the endpoint checks: the
 * Function is bundled separately and cannot import from src/, and a role the
 * endpoint does not know about is rejected rather than emailed blind.
 */
export type ReferralRole = {
  slug: string;
  company: string;
  companyBlurb: string;
  companyUrl?: string;
  title: string;
  lede: string;
  requirements: { title: string; body: string }[];
  seniority: string;
  location: string;
  /**
   * Memory joggers. People rarely recall a name from a requirements list, but
   * they do from a concrete situation ("the engineer who moved into product").
   */
  prompts: string[];
};

export const REFERRAL_ROLES: ReferralRole[] = [
  {
    slug: 'condukt-product',
    company: 'Condukt',
    companyBlurb:
      'Condukt uses real-time data and AI to automate business compliance checks for financial institutions, with teams in London and Porto.',
    companyUrl: 'https://condukt.ai',
    title: 'Product role at Condukt',
    lede: "Condukt is looking for a fairly specific, technical Product person for its Porto team. Could it be you, or someone you know?",
    requirements: [
      { title: 'Product experience', body: '3+ years in Product, working as PO or PM.' },
      { title: 'A strong technical background', body: 'Ideally with a degree in Engineering or IT.' },
      { title: 'Technical products', body: 'Especially infrastructure or API-first products.' },
    ],
    seniority: 'Mid to Senior',
    location: 'Available to be at the Porto office 2+ days a week',
    prompts: [
      'The engineer who moved into Product and never looked back.',
      'The PM your developers actually trust in a technical discussion.',
      'Someone who has shipped an API, a platform or infrastructure product.',
      'A PO in Porto who is ready for a bigger, more technical scope.',
    ],
  },
];
