const LABEL_MAP: Record<string, string> = {
  targetAge: '対象年齢',
  readingStyle: '読み方',
  length: '長さ',
  protagonist: '主人公',
  personality: '主人公の性格',
  setting: '舞台',
  theme: 'テーマ・中心感情',
  wish: '主人公の願い',
  obstacle: '困りごと・障害',
  ending: '終わり方',
  characterCount: '登場人物の数',
  atmosphere: 'お話の雰囲気',
  realism: '現実感',
  storyPattern: '物語の型',
  dialogueAmount: 'セリフ量',
  repetition: '繰り返し表現',
  onomatopoeia: 'オノマトペ',
  motifs: '入れたいモチーフ',
  avoidElements: '避けたい要素',
  season: '季節',
  timeOfDay: '時間帯',
  learningElement: '学び要素',
  protagonistName: '主人公の名前',
  languageLevel: '言葉のやさしさ',
};

export function formatAnswersAsText(answers: Record<string, string>): string {
  const header = '【絵本の要件】';

  if (Object.keys(answers).length === 0) {
    return `${header}\n（まだ回答がありません）`;
  }

  const lines = Object.entries(answers).map(([key, value]) => {
    const label = LABEL_MAP[key] ?? key;
    return `- ${label}: ${value}`;
  });

  return `${header}\n${lines.join('\n')}\n\n以上の要件でストーリーを作ってください。\n【重要】ひらがな・カタカナ中心で書いてください。漢字は使わないでください。`;
}
