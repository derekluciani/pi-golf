# Golf Game

A single-player golf round in which the player completes every hole in a selected course and minimizes their total score.

## Language

**Course**:
An ordered set of one to eighteen hole designs selected for a round. Courses may be built in or supplied by the player.

**Course Unit**:
The abstract measure of distance used for holes, club ranges, and ball movement. Terrain occupies whole course units, while the ball may occupy positions between them.
_Avoid_: Yard, meter, cell

**Round**:
One playthrough of a selected course by one player, with one aggregate score.

**Hole**:
One playable section of the round, beginning at its tee and ending when the ball enters its cup.
_Avoid_: Course, level

**Hole Length**:
The rounded straight-line distance in course units from tee to cup. It is independent of par and may be shorter than the intended route through a curved hole.
_Avoid_: Route length, declared length

**Course Boundary**:
The limit of a hole's playable area. It is independent of the visible terminal viewport.

**Out of Bounds**:
The result of landing or rolling beyond the course boundary. It adds one penalty stroke and requires replay from the previous lie.
_Avoid_: Off-screen

**Cup**:
The target receptacle that completes a hole when a rolling ball enters its capture area at or below the maximum capture speed. An airborne or faster ball passes over it.
_Avoid_: Hole

**Flag**:
The visual marker for the cup when a shot originates outside the green. It is replaced visually by the cup when the shot originates from the green and has no collision behavior of its own.

**Par**:
The expected number of strokes for completing a hole; each hole has a par from three through five.

**Score**:
The total of Hole Scores across the round.

**Hole Score**:
The total of Played Strokes and Penalty Strokes for one Hole.

**Played Strokes**:
The number of counted Stroke attempts taken during a Hole or Round, excluding Penalty Strokes.

**Stroke**:
One counted attempt to advance the ball by taking a shot.

**Penalty Stroke**:
A score increase imposed without taking a shot, such as after entering water.

**Shot**:
An attempt to move the ball, defined by a club, direction, target, and power.

**Shot Direction**:
The selected bearing from the current lie toward the target, chosen in 22.5° steps and preserved between strokes.
_Avoid_: Aim

**Power**:
One of ten fractions from 10% through 100% of the selected club's nominal shot distance. Ball speed is derived non-linearly from power rather than scaled by the same fraction.

**Power Meter**:
The timing challenge used to choose power. Ten whole blocks fill from left to right and empty from right to left without displaying a percentage; stopping commits the visible block count.

**Carry**:
The airborne phase of a shot, beginning at peak ball speed and decelerating non-linearly toward its landing position. Terrain crossed during carry does not affect the ball.

**Roll**:
The ground phase after landing, during which the terrain beneath the ball affects its speed until it stops, enters the cup or water, or goes out of bounds.

**Putt**:
A shot made with the putter. It has no carry and consists entirely of roll.

**Ball Speed**:
The ball's current rate of travel. The selected club determines its initial speed, and its speed determines whether the cup can capture it.

**Club**:
The selected equipment that determines a shot's nominal distance, initial ball speed, and post-landing behavior. Every club may be selected from any playable terrain; poor choices remain legal, and the selection persists between strokes. The available clubs are driver, 3–9 irons, pitching wedge, and putter.

**Target**:
The aiming marker at the selected club's expected full-power distance along the shot direction. It follows the lie's display rule and may differ from the actual landing or rest position when terrain penalties are hidden or the path changes terrain.
_Avoid_: Target spot

**Landing Position**:
The position where carry ends and roll begins. It may fall short of the target because of power or the terrain at the lie.
_Avoid_: Target

**Lie**:
The ball's resting position and its surrounding terrain before a shot.
_Avoid_: Spot, ball location

**Terrain**:
The surface beneath the ball. It determines carry effectiveness from a lie and roll resistance beneath a moving ball; water is non-playable.

**Fairway**:
Short grass intended for normal approach shots.
_Avoid_: Fairway grass

**Rough**:
Longer grass that reduces every non-putter club's carry to 70% of normal and applies high roll resistance. Its carry penalty is not reflected by the target.
_Avoid_: Rough grass

**Green**:
Closely cut grass surrounding the cup and intended for putting. Its roll deceleration for an incoming non-putter shot depends on the original lie and selected club; a putt uses the green's base deceleration.
_Avoid_: Putting green grass

**Bunker**:
A sand-filled hazard that reduces every non-putter club's carry to 40% of normal and stops roll quickly. Its carry penalty is not reflected by the target.
_Avoid_: Sand

**Water Hazard**:
A non-playable hazard that adds one penalty stroke and requires the shot to be replayed from the previous lie.
_Avoid_: Water
