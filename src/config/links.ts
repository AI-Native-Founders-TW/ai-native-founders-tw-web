// 所有外部連結的唯一來源；與 mono 的 Threads 招募客服 SOP 公版保持一致
const MONO = 'https://github.com/AI-Native-Founders-TW/ai-native-founders-tw-mono';
const blob = (path: string) =>
  `${MONO}/blob/main/${path.split('/').map(encodeURIComponent).join('/')}`;

export const links = {
  mono: MONO,
  discord: 'https://discord.gg/xeWYqYaUvU',
  eventThread: 'https://discord.com/channels/1563453138810306612/1564216037623463936',
  founderWords: blob('specs/00-願景和問題/創辦人的話.md'),
  vision: blob('specs/00-願景和問題/vision.md'),
  constitution: blob('specs/01-制度/constitution.md'),
  application: blob('specs/01-制度/[機制]申請制度.md'),
  membersGuide: blob('Members/README.md'),
  newIntro: (filename: string, body: string) =>
    `${MONO}/new/main/Members?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(body)}`,
  webRepo: 'https://github.com/AI-Native-Founders-TW/ai-native-founders-tw-web',
} as const;
