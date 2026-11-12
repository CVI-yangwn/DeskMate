import fs from 'node:fs';
import path from 'node:path';

const modelPath = process.argv[2] ?? 'assets/live2d/haru/Haru.model3.json';
const root = path.dirname(modelPath);
const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const refs = [];

function add(file) {
  if (file) refs.push(file);
}

const f = model.FileReferences ?? {};
add(f.Moc);
for (const texture of f.Textures ?? []) add(texture);
add(f.Physics);
add(f.Pose);
add(f.DisplayInfo);
add(f.UserData);

for (const expression of f.Expressions ?? []) add(expression.File);

for (const group of Object.values(f.Motions ?? {})) {
  for (const motion of group) {
    add(motion.File);
    add(motion.Sound);
  }
}

const missing = refs.filter((file) => !fs.existsSync(path.join(root, file)));
const expressionNames = (f.Expressions ?? []).map((e) => e.Name);
const motionGroups = Object.fromEntries(
  Object.entries(f.Motions ?? {}).map(([name, group]) => [name, group.length]),
);

const result = {
  model: modelPath,
  version: model.Version,
  moc: f.Moc,
  textures: (f.Textures ?? []).length,
  expressions: expressionNames,
  motions: motionGroups,
  lipSyncGroup: (model.Groups ?? []).find((g) => g.Name === 'LipSync')?.Ids ?? [],
  eyeBlinkGroup: (model.Groups ?? []).find((g) => g.Name === 'EyeBlink')?.Ids ?? [],
  hitAreas: (model.HitAreas ?? []).map((h) => h.Name),
  files: refs.length,
  missing,
};

console.log(JSON.stringify(result, null, 2));
if (missing.length > 0) process.exitCode = 1;
