import fs from 'node:fs';
import path from 'node:path';

const modelPath = process.argv[2] ?? 'assets/live2d/hijiki/hijiki.model.json';
const root = path.dirname(modelPath);
const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const refs = [];

function add(file) {
  if (file) refs.push(file);
}

const isCubism4 = Boolean(model.FileReferences);
const f = model.FileReferences ?? {};

if (isCubism4) {
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
} else {
  // Cubism 2 settings (hijiki / tororo)
  add(model.model);
  for (const texture of model.textures ?? []) add(texture);
  add(model.physics);
  add(model.pose);
  for (const group of Object.values(model.motions ?? {})) {
    for (const motion of group) add(motion.file ?? motion.File);
  }
  for (const expression of model.expressions ?? []) add(expression.file ?? expression.File);
}

const missing = refs.filter((file) => !fs.existsSync(path.join(root, file)));
const expressionNames = isCubism4
  ? (f.Expressions ?? []).map((e) => e.Name)
  : (model.expressions ?? []).map((e) => e.name ?? e.Name);
const motionGroups = Object.fromEntries(
  Object.entries(isCubism4 ? (f.Motions ?? {}) : (model.motions ?? {})).map(([name, group]) => [
    name || '(default)',
    group.length,
  ]),
);

const result = {
  model: modelPath,
  format: isCubism4 ? 'cubism3/4' : 'cubism2',
  version: isCubism4 ? model.Version : model.version,
  moc: isCubism4 ? f.Moc : model.model,
  textures: (isCubism4 ? f.Textures ?? [] : model.textures ?? []).length,
  expressions: expressionNames,
  motions: motionGroups,
  lipSyncGroup: (model.Groups ?? []).find((g) => g.Name === 'LipSync')?.Ids ?? [],
  eyeBlinkGroup: (model.Groups ?? []).find((g) => g.Name === 'EyeBlink')?.Ids ?? [],
  hitAreas: isCubism4
    ? (model.HitAreas ?? []).map((h) => h.Name)
    : (model.hit_areas ?? []).map((h) => h.name),
  files: refs.length,
  missing,
};

console.log(JSON.stringify(result, null, 2));
if (missing.length > 0) process.exitCode = 1;
