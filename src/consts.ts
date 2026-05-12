// Site-wide constants. Edit these in one place.

export const SITE = {
  name: 'Mohsen Tahmasebi Nasab',
  formalName: 'Dr. Mohsen Tahmasebi Nasab',
  nameFa: 'محسن طهماسبی نسب',
  role: 'Water Resources Engineer',
  // One-line descriptor shown under the name and in the browser tab.
  tagline: 'Hydrologic and hydraulic modeling, cold-climate hydrology, flood-risk reduction',
  description:
    'Personal site of Dr. Mohsen Tahmasebi Nasab, a water resources engineer working on hydrologic and hydraulic modeling, cold-climate hydrology, flood-risk reduction, and practical Python tools for the field.',
  url: 'https://hydromohsen.com',
  email: 'mohsen.tahmasebi.n@gmail.com',
  // Social-share image. Replace with a real /public/og.png later.
  ogImage: '/favicon.svg',
};

// Top navigation. Order = display order. First item is the homepage.
export const NAV: { label: string; href: string }[] = [
  { label: 'About', href: '/' },
  { label: 'Publications', href: '/publications' },
  { label: 'Projects', href: '/projects' },
  { label: 'Tutorials', href: '/tutorials' },
  { label: 'Photography', href: '/photography' },
  { label: 'Tools', href: '/tools' },
  { label: 'Teaching', href: '/teaching' },
  { label: 'Blog', href: '/blog' },
  { label: 'Media', href: '/media' },
];

// Profile links shown in the hero and footer.
export type Social = { label: string; href: string; icon: string };
export const SOCIALS: Social[] = [
  { label: 'Google Scholar', href: 'https://scholar.google.com/citations?user=WzJw2KIAAAAJ&hl=en', icon: 'scholar' },
  { label: 'GitHub', href: 'https://github.com/mohsennasab', icon: 'github' },
  { label: 'YouTube', href: 'https://www.youtube.com/@HydroMohsen', icon: 'youtube' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/hydromohsen', icon: 'linkedin' },
];

// GitHub username, used to build repo links on the Tools page.
export const GITHUB_USER = 'mohsennasab';
export const gh = (repo: string) => `https://github.com/${GITHUB_USER}/${repo}`;

// YouTube
export const YT = {
  channel: 'https://www.youtube.com/@HydroMohsen',
  playlists: {
    waterResources: 'https://www.youtube.com/playlist?list=PLH_IXkBFEbCVsHZuDG0Jwjw9bTDZwy6nQ',
    fluidMechanics: 'https://www.youtube.com/playlist?list=PLH_IXkBFEbCX2VZU7cyFwgT2OfKf4Lez_',
    arcgisWRE: 'https://www.youtube.com/playlist?list=PLH_IXkBFEbCX-iXlvx-lU0_5KmLtQKr3v',
  },
  // Video IDs for inline embeds.
  ids: {
    pythonGettingStarted: 'XCqIm18dVT4', // "Getting Started with Python for H&H"
    seniorDesign: 'ti6J3CyEjhQ', // students' senior design project video
  },
  // Convenience watch URLs.
  pythonGettingStarted: 'https://youtu.be/XCqIm18dVT4',
  seniorDesignVideo: 'https://youtu.be/ti6J3CyEjhQ',
  // A few featured videos sampled from the channel.
  samples: [
    { id: 'xorg89QZ8F4', title: "Magic with Bernoulli's principle" },
    { id: '06q7_90tk54', title: 'Watershed Delineation with ArcHydro in ArcGIS Pro' },
    { id: 'gyGixsNdLGo', title: 'Normal depth for a partially-full circular pipe (Part 1)' },
    { id: 'APIt7G6JdQw', title: 'Measuring saturated hydraulic conductivity with SATURO' },
  ] as { id: string; title: string }[],
};
