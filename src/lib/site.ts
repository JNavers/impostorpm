/**
 * Single source of truth for site chrome.
 *
 * The nav and footer were previously copy-pasted into every page, which is how
 * they drifted: the copyright read "Impostor PM" on two pages and "The Impostor
 * PM" on a third, and the "Our events" dropdown pointed at /boost-2nd in one
 * place and /huddle in another. Edit here, not in a page.
 */

export const SITE = {
  name: 'The Impostor PM',
  url: 'https://www.impostor.pm',
  /** Resolved once. Previously inconsistent across pages. */
  copyright: `© ${new Date().getFullYear()} The Impostor PM. All rights reserved.`,
  defaultDescription:
    'Community and live tools for Product Managers. Real-world practice over performance.',
  logo: '/brand/tipm-logo-horizontal-white.svg',
} as const;

export type NavItem = {
  label: string;
  href: string;
  children?: { label: string; href: string }[];
};

export const NAV: NavItem[] = [
  {
    label: 'Our events',
    href: '#',
    children: [
      { label: 'Club', href: '/club' },
      { label: 'Product Talks', href: '/product-talks' },
      { label: 'Huddle', href: '/huddle' },
      // huddle/index.html linked this as /boost-2nd, which 404s. The live page
      // is /boost ("The Impostor PM Boost"). index-static.html omitted Boost
      // entirely and listed Huddle instead — this is the union of both, minus
      // the dead URL.
      { label: 'Boost', href: '/boost' },
    ],
  },
  { label: 'Benefits', href: '/benefits' },
];

/** Rendered as the filled button at the end of the nav. */
export const NAV_CTA = {
  label: 'Bring to my city',
  href: '/bring-the-club-to-my-city',
};

export const FOOTER_GROUPS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'This is Us',
    links: [
      { label: 'What is a Club?', href: '/club' },
      { label: 'Product Talks', href: '/product-talks' },
      { label: 'Slack Group', href: '/group' },
      { label: 'Salary Compass', href: '/compensation' },
      { label: 'Huddle', href: '/huddle' },
      { label: 'About us', href: '/about' },
    ],
  },
  {
    title: 'Our Clubs',
    links: [
      { label: 'Hamburg', href: '/club/hamburg' },
      { label: 'Lisbon', href: '/club/lisbon' },
      { label: 'Braga', href: '/club/braga' },
      { label: 'Porto', href: '/club/porto' },
      { label: 'Coimbra', href: '/club/coimbra' },
      { label: 'Host a Club!', href: '/bring-the-club-to-my-city' },
    ],
  },
  {
    title: 'Benefits',
    links: [
      { label: 'Product Buildcamp', href: '/product-buildcamp' },
      { label: 'Productized', href: '/productized' },
      { label: 'Tekya', href: '/tekya' },
      { label: 'Next Level Hub', href: '/nextlevelhub' },
      { label: 'Product Circle', href: 'https://www.productcircle.co/' },
      { label: 'Builders Camp', href: '/builderscamp' },
      { label: 'Partner with us', href: '/partner-with-us' },
    ],
  },
];

export const SOCIALS: { label: string; href: string; icon: 'linkedin' | 'slack' | 'luma' }[] = [
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/impostorpm/', icon: 'linkedin' },
  { label: 'Slack', href: 'https://tally.so/r/w2X0de', icon: 'slack' },
  { label: 'Luma calendar', href: 'https://luma.com/impostorpm', icon: 'luma' },
];
