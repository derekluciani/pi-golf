import { rasterizeHole, validateCourse } from "./index.ts";

const offset = 10_000_000_000_000_000;
const input = {
  schemaVersion: 1,
  id: "large-offset-course",
  name: "Large Offset Course",
  holes: [{
    id: "large-offset-hole",
    number: 1,
    par: 3,
    boundary: {
      type: "polygon",
      points: [
        { x: offset, y: 0 },
        { x: offset + 8, y: 0 },
        { x: offset + 8, y: 8 },
        { x: offset, y: 8 },
      ],
    },
    tee: { x: offset + 2, y: 2 },
    cup: { x: offset + 6, y: 6 },
    regions: [{
      terrain: "green",
      shape: {
        type: "ellipse",
        center: { x: offset + 6, y: 6 },
        radiusX: 1,
        radiusY: 1,
      },
    }],
  }],
};

const validation = validateCourse(input);
if (!validation.ok) {
  throw new Error(`Large-offset Course did not validate: ${JSON.stringify(validation.errors)}`);
}

const hole = validation.value.holes[0];
if (hole === undefined) throw new Error("Large-offset Course has no Hole.");

const first = JSON.stringify(rasterizeHole(hole));
for (let repetition = 0; repetition < 3; repetition += 1) {
  const repeated = JSON.stringify(rasterizeHole(hole));
  if (repeated !== first) throw new Error("Large-offset rasterization was not deterministic.");
}

process.stdout.write(`${first.length}\n`);
