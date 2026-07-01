const ADJECTIVES = [
  'Blue', 'Swift', 'Bold', 'Calm', 'Bright', 'Quiet', 'Sharp', 'Wild',
  'Gentle', 'Brave', 'Eager', 'Fierce', 'Jolly', 'Kind', 'Lively',
  'Merry', 'Noble', 'Proud', 'Radiant', 'Sunny',
];

const ANIMALS = [
  'Falcon', 'Otter', 'Wolf', 'Hawk', 'Fox', 'Bear', 'Eagle', 'Tiger',
  'Panda', 'Heron', 'Lynx', 'Raven', 'Stag', 'Crane', 'Viper',
  'Bison', 'Moose', 'Dingo', 'Gecko', 'Finch',
];

function pick<T>(arr: T[]): T {
  const item = arr[Math.floor(Math.random() * arr.length)];
  if (item === undefined) {
    throw new Error('pick called on empty array');
  }
  return item;
}

export function generateDisplayName(): string {
  const num = Math.floor(10 + Math.random() * 90);
  return `${pick(ADJECTIVES)}${pick(ANIMALS)}${num}`;
}
