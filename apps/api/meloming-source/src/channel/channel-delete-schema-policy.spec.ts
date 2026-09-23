import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Channel deletion referential policy', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  );

  const channelRelations = Array.from(
    schema.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g),
  ).flatMap((modelMatch) => {
    const model = modelMatch[1];
    const body = modelMatch[2];
    return Array.from(
      body.matchAll(
        /^\s*\w+\s+Channel\??\s+@relation\(([\s\S]*?)\)\s*$/gm,
      ),
    ).map((relationMatch) => ({
      model,
      definition: relationMatch[0].trim(),
      options: relationMatch[1],
    }));
  });

  it('requires every physical Channel foreign key to declare an onDelete policy', () => {
    const implicitRelations = channelRelations.filter(
      ({ options }) => !/\bonDelete\s*:/.test(options),
    );

    expect(implicitRelations).toEqual([]);
  });

  it('does not allow a direct Channel foreign key to block deletion', () => {
    const restrictedModels = channelRelations
      .filter(({ options }) => /\bonDelete\s*:\s*Restrict\b/.test(options))
      .map(({ model }) => model)
      .sort();

    expect(restrictedModels).toEqual([]);
  });
});
