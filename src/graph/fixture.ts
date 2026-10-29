import type { Graph } from './index';

/** mono 讀不到、或建置發生錯誤時的退路，讓網站仍可建置。 */
export const fixture: Graph = {
  generatedAt: new Date(0).toISOString(),
  people: [
    {
      id: 'name:ray',
      name: 'Ray 貓',
      hasIntro: false,
      roles: [{ label: 'Landing Page', source: 'A5' }],
    },
    {
      id: 'name:sun',
      name: 'Sun',
      hasIntro: false,
      roles: [{ label: '網站 UI UX', source: 'A12' }],
    },
  ],
  contributions: [
    { person: 'name:ray', kind: 'lead', target: 'website', label: 'Owner' },
    { person: 'name:sun', kind: 'design', target: 'website', label: 'Logo' },
  ],
};
