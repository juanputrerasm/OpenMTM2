/*
  The announcer (MONSTER_EXE_ANALYSIS.md 12, "Commentary (Trucksfx.c)"). A phrase is a short script of voice clips:
  plain `name.wav` tokens, and driver names `(<<n>>`, `*<<n>>` and `)<<n>>`, which are the nth driver's name clip in
  its rising, flat or falling voice (the three "Wave File" names of the truck's .TRK). The game plays the clips as one
  sound and shows the phrase's line as text; the lines are the commentary's part of the game's message table (the
  "MTM2.loc" no POD ships), so they are message tags here and a `.LOC` or a language can reword them.

  - `PHRASES`: each group's phrases as the EXE lists them, with `camera` on the lines said only when the truck the
    camera follows is in the event (and close, for the passing groups), `when` on the two with a rule of their own,
    and `of` on the one that names the event's second truck as its first.
  - `GROUPS`: each queued group's place in the queue: priority (lower first), the silence it needs, its life.
  - `createCommentaryQueue`: the game's queue (0x4213a0): one phrase a frame, the ready one with the lowest priority.
  - `createPhrasePicker`: each group's shuffle bag (RANDGEN, 0x421ef0); a line drawn that may not be said is used up
    and nothing is said.
  - `CP3_PHRASES`, `CP3_GROUPS`: Community Patch 3's announcer (docs/CP3_EXE_ANALYSIS.md 4), larger bags, new calls and
    shorter pauses; `commentaryTables({ cp3 })` gives the tables a race uses.

  Pure, so it runs under Node.
*/
import { msg } from "./strings.js";

const P = (script, text, extra = {}) => Object.freeze({ script, text, ...extra });

/** Each group's phrases: `script` the clips, `text` the line (a message tag), `camera` and `when` as above. */
export const PHRASES = Object.freeze({
  introRace: [
    P("getready.wav", msg("Get Ready!")),
    P("start_10.wav", msg("Please fasten your seatbelts and return 'em to the upright position; this is gonna be a little bit bumpy.")),
    P("gen_11.wav", msg("Ready or not, here we go!")),
    P("gen_21.wav", msg("Are you ready for some down and dirty racing?")),
  ],
  introSummit: [
    P("gen_19.wav", msg("Everybody ready to rassle?")),
    P("gen_20.wav", msg("Let's get ready to rassle.")),
    P("start_09.wav", msg("This is where we separate the men from the boys.")),
    P("gen_43.wav", msg("Now don't go biting anyone's ear off out there.")),
    P("sum_14.wav", msg("Who wants it more?")),
    P("load_05.wav", msg("Do all roads lead to the top? We'll soon find out.")),
  ],
  go: [P("go.wav", "")],
  finishWinner: [
    P("whatfin.wav", msg("What a finish! What a race!")),
    P("(<<1>> crown.wav", msg("<<1>> takes the monster crown.")),
    P("(<<1>> wincirc.wav", msg("<<1>> is in the winner's circle this time.")),
    P("(<<1>> pull.wav *<<2>> allway.wav", msg("<<1>> pulls it out! It's <<2>> all the way.")),
    P("(<<1>> takehome.wav", msg("<<1>> takes one home.")),
    P("(<<1>> cruise.wav", msg("<<1>> can take a cruise down victory lane.")),
    P("win_02.wav )<<1>>", msg("Looks like today is payday for <<1>>.")),
  ],
  hasFinished: [P("(<<1>> hasfin.wav", msg("<<1>> has finished the race."))],
  hasWon: [P("(<<1>> haswon.wav", msg("<<1>> has won the race."))],
  move: [
    P("(<<1>> makemove.wav", msg("<<1>> is making its move.")),
    // Said of the truck ahead: the event's second truck is the phrase's first (`of`).
    P("fear.wav )<<1>>", msg("This is where the fear starts for <<1>>."), { of: [2] }),
    P("whobe.wav", msg("Who's it gonna be?"), { camera: true }),
    P("pass_01.wav", msg("This road ain't big enough for the both of ya."), { camera: true }),
  ],
  pass: [
    P("its.wav *<<1>> allway2.wav", msg("It's <<1>> all the way."), { camera: true }),
    P("(<<1>> kisslead.wav", msg("<<1>> can kiss that lead goodbye."), { when: "passedLeader" }),
    P("pass_03b.wav", msg("Like taking candy from a baby."), { camera: true }),
    P("(<<1>> pass_05.wav", msg("<<1>> shows no mercy."), { camera: true }),
    P("(<<1>> pass_06.wav", msg("<<1>> turns the tables."), { camera: true }),
    P("(<<1>> pass_13.wav )<<2>>", msg("<<1>> inches past <<2>>.")),
  ],
  lead: [
    P("(<<1>> leadpack.wav", msg("<<1>> wants to be the leader of the pack.")),
    P("(<<1>> makelead.wav", msg("<<1>> is making its move and going for that lead position.")),
    P("betpack.wav *<<1>> holdback.wav", msg("You can bet the pack is going to try and hold <<1>> back.")),
  ],
  edge: [
    P("(<<1>> outedge.wav", msg("<<1>> is taking the outside edge.")),
    P("(<<1>> longhome.wav", msg("<<1>> is taking the long way home.")),
  ],
  goingYourWay: [
    P("goway.wav", msg("When it's going your way, its going your way.")),
    P("hardwork.wav )<<1>>", msg("Hard work pays off for <<1>>.")),
    P("pass_03b.wav", msg("Like taking candy from a baby.")),
    P("(<<1>> pass_05.wav", msg("<<1>> shows no mercy.")),
    P("(<<1>> pass_06.wav", msg("<<1>> turns the tables.")),
  ],
  clash: [
    P("clash.wav", msg("Clash of the titans!"), { camera: true }),
    P("(<<1>> and1.wav *<<2>> upclose.wav", msg("<<1>> and <<2>> are getting up close and personal.")),
    P("(<<1>> and2.wav *<<2>> headache.wav", msg("<<1>> and <<2>> are going head to head and somebody's going to end up with a headache.")),
    P("pisthead.wav", msg("That's how pistonheads say hello."), { camera: true }),
    P("getatten.wav )<<1>>", msg("That should get the attention of <<1>>."), { camera: true }),
    P("seerear.wav", msg("How'd you like to see that in your rear view mirror?"), { camera: true }),
    P("bitedust.wav", msg("Another one bites the dust."), { camera: true }),
    P("gotbreak.wav", msg("That's gotta break the heart of any competitor."), { camera: true }),
    P("crash_01.wav", msg("Nothing a little plastic surgery can't fix."), { camera: true }),
    P("crash_05.wav", msg("Bam! Who's passing out the harps and the halos?"), { camera: true }),
    P("crash_08.wav", msg("Hey, that's coming out of somebody's paycheck."), { camera: true }),
    P("crash_11.wav", msg("Oh, the humanity."), { camera: true }),
    P("add_01.wav", msg("That's gonna leave a mark!"), { camera: true }),
  ],
  cow: [P("gen_14.wav", msg("Cowabunga!"))],
  water: [
    P("(<<1>> walkwatr.wav", msg("<<1>> is walking on water.")),
    P("(<<1>> overhead.wav", msg("<<1>> may be in over its head.")),
    P("(<<1>> fishing.wav", msg("<<1>> has gone fishing.")),
    P("amphib.wav", msg("I've heard of amphibious cars, but this is ridiculous."), { camera: true }),
    P("(<<1>> drink.wav", msg("<<1>> has gone in the drink.")),
    P("(<<1>> terr_02.wav", msg("<<1>> is doing it in the drink.")),
    P("(<<1>> water_01.wav", msg("<<1>> wants to sail the seven seas.")),
  ],
  spin: [
    P("olympic.wav", msg("This could be an Olympic event in the year 2000.")),
    P("tripaxle.wav", msg("What's next, a triple axel from the double axle?")),
  ],
  ice: [
    P("chains.wav", msg("Chains will not, I repeat, will not be required for this event.")),
    P("idonthnk.wav *<<1>> chains2.wav", msg("I don't think <<1>> will need chains for this event.")),
  ],
  air: [
    P("(<<1>> doingair.wav", msg("<<1>> is doing it in the air.")),
    P("(<<1>> flyfin.wav", msg("<<1>> is flying to the finish line."), { when: "nearFinish" }),
    P("(<<1>> terr_03.wav", msg("<<1>>'s got four big wheels but ain't using any of 'em!")),
    P("terr_04a.wav *<<1>>, terr_04b.wav", msg("Here comes <<1>>, duck and cover!")),
    P("(<<1>> terr_05.wav", msg("<<1>> is reaching for the stars.")),
  ],
  roll: [
    P("rollbaby.wav", msg("Roll baby roll.")),
    P("beethov.wav", msg("Roll over Beethoven.")),
    P("(<<1>> crshdest.wav", msg("<<1>> has crashed, leaving an incredible path of destruction behind it.")),
  ],
  wheelie: [
    P("(<<1>> hangten.wav", msg("<<1>> is hanging ten.")),
    P("(<<1>> tippytoe.wav", msg("<<1>> is on its tippy toes.")),
    P("leaninto.wav", msg("Lean into it.")),
  ],
  flipped: [
    P("(<<1>> bellyup.wav", msg("<<1>> has gone belly side up, so the whirly bird's gonna fix 'em up.")),
    P("ridediff.wav", msg("Now for a ride of a different sort."), { camera: true }),
    P("ourbuddy.wav *<<1>> needhand.wav", msg("Our old buddy <<1>> needs a helping hand.")),
    P("whirly.wav", msg("The whirly bird's comin' in."), { camera: true }),
    P("whirly2.wav", msg("They're calling in the whirly bird for the big flip."), { camera: true }),
    P("(<<1>> hook.wav", msg("<<1>> is on the hook.")),
  ],
  missedCheckpoint: [
    P("gen_35.wav", msg("Now listen.  What part of the word \"checkpoint\" do you not understand?")),
    P("(<<1>> checkpnt.wav", msg("<<1>> has just missed a checkpoint. Turn around buddy.")),
  ],
  stealth: [
    P("(<<1>> add_15.wav", msg("<<1>> is driving in the stealth mode.")),
    P("add_17.wav", msg("Watch those tail lights."), { camera: true }),
  ],
  blimp: [P("blimp_01.wav", ""), P("blimp_02.wav", "")],
});

/**
 * Each queued group's figures for a truck the announcer talks about (the player's, or the one the camera follows):
 * `priority` (lower first), `silence` the seconds the announcer must have been quiet, `life` the seconds it may wait.
 * The start, GO and the finish lines that are said at once are `now`.
 */
export const GROUPS = Object.freeze({
  introRace: { now: true }, introSummit: { now: true }, go: { now: true },
  finishWinner: { priority: 0, silence: 0, life: 1 },
  hasWon: { priority: 0, silence: 0, life: 1 },
  hasFinished: { priority: 5, silence: 2, life: 3 },
  move: { priority: 10, silence: 6, life: 3 },
  pass: { priority: 8, silence: 6, life: 2.5 },
  lead: { priority: 6, silence: 6, life: 2.5 },
  edge: { priority: 15, silence: 8, life: 3 },
  goingYourWay: { priority: 8, silence: 6, life: 2.5 },
  clash: { priority: 4, silence: 3, summitSilence: 8, life: 2 },
  cow: { priority: 10, silence: 8, life: 3 },
  water: { priority: 15, silence: 8, life: 3 },
  spin: { priority: 15, silence: 8, life: 3 },
  ice: { priority: 15, silence: 8, life: 3 },
  air: { priority: 13, silence: 8, life: 3 },
  roll: { priority: 13, silence: 8, life: 3 },
  wheelie: { priority: 20, silence: 8, life: 3 },
  flipped: { priority: 2, silence: 8, life: 3 },
  missedCheckpoint: { priority: 2, silence: 8, life: 3 },
  stealth: { priority: 10, silence: 8, life: 3 },
  blimp: { priority: 100, silence: 5, life: 0.1 },
});

/*
  Community Patch 3's announcer (docs/CP3_EXE_ANALYSIS.md 4). Its bags replace the retail ones whole (the retail lines
  stay in them); the new groups are its new calls. A script token `<<n>>` with no voice mark is a number, said with
  `NUMBER_CLIPS` (the drag countdowns' seconds).
*/
const CAM = { camera: true };
export const CP3_PHRASES = Object.freeze({
  // The groups CP3 leaves as they were.
  ...PHRASES,
  introRace: [
    ...PHRASES.introRace,
    P("start_01.wav", msg("Those trucks are lighting the fires and smoking the tires.")),
    P("start_02.wav", msg("Those trucks are lighting the fires and smoking the tires. Let's go.")),
    P("start_07.wav", msg("Here comes the big boys.")),
    P("start_11.wav", msg("Just because you have a truck, doesn't mean you can drive. Let's see what you got.")),
    P("start_12.wav", msg("Hey buddy, ready to get muddy?")),
    P("start_18.wav", msg("Ah, how do I love these trucks. Let me count the ways.")),
    P("stump_01.wav", msg("Now is the time to make some tracks.")),
    P("rock_04.wav", msg("Who's it gonna be at the back of this pack?")),
    P("whobe2.wav", msg("Who's it gonna be?")),
    P("coltry.wav", msg("They're gonna give it the old college try, although frankly, I don't think these drivers went to college.")),
    P("tearstan.wav", msg("They'll be tearing down the grandstands when they see this.")),
    P("prove.wav", msg("These trucks are out to prove something.")),
    P("tuffrace.wav", msg("This is one tough race.")),
  ],
  introSummit: [
    ...PHRASES.introSummit,
    P("king_01.wav", msg("Train tracks, trucks and trestles, it doesn't get much better than this.")),
    P("load_07.wav", msg("Let's get inside the squared circle.")),
    P("sum_12.wav", msg("Prepare yourself, this ain't no funhouse.")),
    P("sum_13.wav", msg("This is the part of town that yo' mamma always warned you about.")),
    P("add_12.wav", msg("There can only be one.")),
    P("whobe2.wav", msg("Who's it gonna be?")),
    P("coltry.wav", msg("They're gonna give it the old college try, although frankly, I don't think these drivers went to college.")),
  ],
  introSnake: [
    P("snake_01.wav", msg("In Snake Canyon country, the secret to success is to slither past all those other suckers.")),
    P("snake_02.wav", msg("Which one of you reptiles is going to be king of Snake Canyon?")),
  ],
  introNight: [
    P("night_01.wav", msg("Hey, who turned out all the lights?")),
    P("night_02.wav", msg("These trucks are doing it on the dark side.")),
  ],
  introSnow: [
    P("snow_01.wav", msg("Looks like Frosty is in for one wild ride!")),
    P("snow_02.wav", msg("Trucketh in a winter wonderland.")),
  ],
  introFog: [
    P("fog_01.wav", msg("I cannot see a thing.")),
    P("fog_02.wav", ""),
    P("fog_03.wav", msg("What's up ahead? Danged if I know.")),
    P("fog_04.wav", msg("This stuff is thicker than molasses in January.")),
    P("fog_05.wav", msg("It's as clear as mud out there.")),
    P("wea_02.wav", msg("Looks like we all got blindfolds on. I can't see a thing!")),
  ],
  finishWinner: [
    P("(<<1>> haswon.wav", msg("<<1>> has won the race.")),
    P("(<<1>> stage12.wav", msg("<<1>> has won the race.")),
    P("(<<1>> hasone.wav", msg("<<1>> has won the race.")),
    ...PHRASES.finishWinner,
    P("win_01.wav", msg("There's no day like payday.")),
  ],
  move: [
    ...PHRASES.move,
    P("pass_10.wav )<<1>>", msg("Abandon all hope, here comes <<1>>."), CAM),
    P("pass_12a.wav *<<1>> pass_12b.wav", msg("My oh my, <<1>> is making the move."), CAM),
    P("pass_08.wav", msg("Hell has no fury like a Monster Truck scorned."), CAM),
    P("(<<1>> start_08.wav", msg("<<1>> is a truck with a mission."), CAM),
  ],
  pass: [
    ...PHRASES.pass,
    P("(<<1>> pass_09.wav", msg("<<1>> has turned the tables."), CAM),
    P("pass_14.wav", msg("The worm has turned."), CAM),
    P("track_4a.wav *<<1>> track_4b.wav", msg("Looks like <<1>> made a deal with the local witchdoctor."), CAM),
    P("pass_11.wav", msg("Drive, you magnificent Monster Truck. Drive."), CAM),
  ],
  clash: [
    ...PHRASES.clash,
    P("crash_09.wav", msg("This one is off the Richter scale."), CAM),
    P("crash_12.wav", msg("Knocks one out of the park."), CAM),
    P("crash_13.wav", msg("Maybe down for the count."), CAM),
    P("crash_14.wav", msg("Just opened a big ol' can of whoop ass on those other trucks."), CAM),
    P("crash_15.wav", msg("Just opened a big ol' can of whoop ass on the competition."), CAM),
    P("crash_16.wav", msg("Demolition Derby time!"), CAM),
    P("add_24.wav", msg("That boy ain't right."), CAM),
    P("gen_07.wav", msg("What the heck was that?"), CAM),
    P("(<<1>> game_01.wav", msg("<<1>> will not budge."), CAM),
    P("(<<1>> sum_18.wav", msg("<<1>> takes a direct hit."), CAM),
    P("add_31.wav", msg("Those wrestle trucks are hard to beat."), CAM),
    P("gen_29.wav", msg("Sic 'em."), CAM),
    P("sum_19.wav", msg("Clash of the titans."), CAM),
    P("mkeblood.wav", msg("That'll make your blood start flowin'."), CAM),
    P("(<<2>> gen_23.wav", msg("<<2>> is having the other truck for lunch.")),
  ],
  spin: [...PHRASES.spin, P("rink_01.wav", msg("What about the pairs competition?"))],
  flipped: [
    ...PHRASES.flipped,
    P("gen_09.wav", msg("Looks like that truck had one too many."), CAM),
    P("gen_15.wav", msg("The big trucks cometh."), CAM),
    P("gen_16a.wav *<<1>> gen_16b.wav", msg("The <<1>> cometh.")),
    P("gen_30.wav", msg("Spoken like a true champion."), CAM),
    P("gen_32.wav", msg("I have never seen anything like that before."), CAM),
    P("gen_40.wav", msg("Un-freaking-believable."), CAM),
    P("smelrose.wav", msg("I've heard of stopping to smell the roses, but this is ridiculous."), CAM),
    P("(<<1>> overcent.wav", msg("<<1>> has gone over to say hello to the neighbors, which means the truck's out of the competition.")),
    P("thunkit.wav", msg("Who would've thunk it?"), CAM),
    P("gen_04.wav", msg("When going your way, it's still going your way."), CAM),
    P("unbeliev.wav", msg("Unbelievable!"), CAM),
    P("keepontr.wav", msg("Keep on truckin'."), CAM),
  ],
  missedCheckpoint: [P("gen_03.wav", msg("Don't forget to hit your checkpoints.")), ...PHRASES.missedCheckpoint],
  blimp: [...PHRASES.blimp, P("blimp_03.wav", msg("And now for the blimp side view."))],
  finalLap: [P("add_35.wav", msg("One more lap to go."))],
  sign: [
    P("(<<1>> signcake.wav", msg("<<1>> specialty: road sign pancakes.")),
    P("truktime.wav", msg("Signs of monster truckin' times.")),
    P("alivkill.wav", msg("If that were alive, it'd be roadkill now.")),
  ],
  barricade: [P("(<<1>> detour.wav", msg("<<1>> is looking for a detour."))],
  train: [
    P("train_01.wav", msg("That ain't no love train comin' down the tracks. Watch out!")),
    P("train_02.wav", msg("The score as it stands right now... Big Giant Train: 1, Monster Truck: 0")),
    P("train_03.wav", msg("If you wanna ride that train, you gotta buy a ticket.")),
  ],
  summitHold: [
    P("(<<1>> sum_05.wav", msg("<<1>> appears to be glued to the top of that thing.")),
    P("(<<1>> sum_07.wav", msg("<<1>> is standing its ground.")),
    P("(<<1>> sum_08.wav", msg("<<1>> won't budge. How long can he stay up there?")),
    P("add_33.wav", msg("The points continue to pour on.")),
    P("add_34.wav )<<1>>", msg("The points are piling up for <<1>>.")),
    P("game_02.wav", msg("And the clock continues to tick away.")),
  ],
  summitKnocked: [
    P("(<<1>> add_02.wav", msg("<<1>> has left the building.")),
    P("(<<1>> add_05.wav", msg("<<1>> has taken a leave of absence.")),
    P("(<<1>> add_06.wav", msg("<<1>> has fallen off the summit.")),
    P("sum_17.wav", msg("Look out below!")),
    P("terr_12.wav", msg("Maybe down for the count. No, he's on his feet again!")),
  ],
  summitOut: [P("(<<1>> add_10.wav", msg("<<1>> steps out of the ring."))],
  summitLeader: [
    P("(<<1>> add_03.wav", msg("<<1>> has taken over the summit.")),
    P("add_04a.wav *<<1>> add_04b.wav", msg("Now <<1>> is on top.")),
    P("(<<1>> add_11.wav", msg("<<1>> takes the top.")),
    P("(<<1>> game_06.wav", msg("<<1>> is dominating the summit.")),
    P("(<<1>> gen_28.wav", msg("<<1>> turns the tables.")),
    P("(<<1>> gen_37.wav", msg("<<1>> is kicking up mud and taking names.")),
    P("gen_41.wav", msg("Un-freaking-stoppable.")),
    P("game_07.wav", msg("Who says it's lonely at the top?")),
    P("add_21.wav", msg("Yeehaw!")),
  ],
  dragPrestageTime: [P("(<<1>> STAGE5.WAV <<2>> SECONDS.WAV STAGE6.WAV", msg("<<1>> has <<2>> seconds to prestage."))],
  dragStageTime: [P("(<<1>> STAGE5.WAV <<2>> SECONDS.WAV STAGE7.WAV", msg("<<1>> has <<2>> seconds to stage."))],
  dragPrestaged: [P("(<<1>> STAGE1.WAV", msg("<<1>> is prestaged."))],
  dragStaged: [P("(<<1>> STAGE2.WAV", msg("<<1>> is staged."))],
  dragRedLight: [P("(<<1>> STAGE3.WAV", msg("<<1>> has red lighted."))],
  dragJump: [P("(<<1>> stage4.wav )<<2>>", msg("<<1>> has the jump on <<2>>."))],
  dragCentreLine: [P("(<<1>> STAGE8.WAV", msg("<<1>> has been disqualified for crossing the center line."))],
  dragOutsideEdge: [P("(<<1>> STAGE13.WAV", msg("<<1>> has been disqualified for crossing the outside edge."))],
  dragReversing: [P("(<<1>> STAGE14.WAV", msg("<<1>> has been disqualified for reversing on the track."))],
  dragTimeLimit: [P("(<<1>> STAGE9.WAV", msg("<<1>> has been disqualified for exceeding the time limit."))],
  dragHeatWinner: [P("(<<1>> STAGE11.WAV", msg("<<1>> has won the heat."))],
});

/** CP3's figures: the retail ones, the winner's life raised to 8 s, and its new calls (docs/CP3_EXE_ANALYSIS.md 4). */
export const CP3_GROUPS = Object.freeze({
  ...GROUPS,
  introSnake: { now: true }, introNight: { now: true }, introSnow: { now: true }, introFog: { now: true },
  finishWinner: { priority: 0, silence: 0, life: 8 },
  hasWon: { priority: 0, silence: 0, life: 8 },
  finalLap: { priority: 3, silence: 0.5, life: 8 },
  sign: { priority: 10, silence: 8, life: 3 },
  barricade: { priority: 10, silence: 8, life: 3 },
  train: { priority: 10, silence: 8, life: 3 },
  summitHold: { priority: 16, silence: 14, life: 3 },
  summitKnocked: { priority: 6, silence: 4, life: 1.5 },
  summitOut: { priority: 12, silence: 8, life: 1.5 },
  summitLeader: { priority: 8, silence: 5, life: 2 },
  dragPrestageTime: { now: true }, dragStageTime: { now: true }, dragPrestaged: { now: true }, dragStaged: { now: true },
  dragRedLight: { priority: 1, silence: 0, life: 8 },
  dragJump: { priority: 6, silence: 0, life: 3 },
  dragCentreLine: { priority: 1, silence: 0, life: 8 },
  dragOutsideEdge: { priority: 1, silence: 0, life: 8 },
  dragReversing: { priority: 1, silence: 0, life: 8 },
  dragTimeLimit: { priority: 1, silence: 0, life: 8 },
  dragHeatWinner: { priority: 0, silence: 0, life: 8 },
});

/** CP3's `commentarySilence` default: every phrase needs 60% of its silence (docs/CP3_EXE_ANALYSIS.md 4.1). */
export const CP3_SILENCE_SCALE = 0.6;

/** The number clips CP3 says a figure with: 0 to 20, 30, 40 and 50. */
export const NUMBER_CLIPS = Object.freeze({
  0: "ZERO.WAV", 1: "ONE.WAV", 2: "TWO.WAV", 3: "THREE.WAV", 4: "FOUR.WAV", 5: "FIVE.WAV", 6: "SIX.WAV", 7: "SEVEN.WAV",
  8: "EIGHT.WAV", 9: "NINE.WAV", 10: "TEN.WAV", 11: "ELEVEN.WAV", 12: "TWELVE.WAV", 13: "THIRTEEN.WAV", 14: "FOURTEEN.WAV",
  15: "FIFTEEN.WAV", 16: "SIXTEEN.WAV", 17: "SEVENTEE.WAV", 18: "EIGHTEEN.WAV", 19: "NINETEEN.WAV", 20: "TWENTY.WAV",
  30: "THIRTY.WAV", 40: "FORTY.WAV", 50: "FIFTY.WAV",
});

/** The tables a race's announcer uses: retail's, or CP3's with its shorter pauses. */
export function commentaryTables({ cp3 = false } = {}) {
  return cp3
    ? { phrases: CP3_PHRASES, groups: CP3_GROUPS, silenceScale: CP3_SILENCE_SCALE }
    : { phrases: PHRASES, groups: GROUPS, silenceScale: 1 };
}

/** The queue holds at most this many phrases (the game's 32 slots). */
export const QUEUE_SLOTS = 32;
/** The game's FUN_00421600 plays every phrase at 0.7. */
export const COMMENTARY_GAIN = 0.7;

/**
 * The clips in a phrase: `{ kind: "wav", name }`, `{ kind: "name", variant, arg }` and, for CP3's `<<n>>` with no voice
 * mark, `{ kind: "number", arg }` (arg counts from 1).
 */
export function parseSpec(spec) {
  const out = [];
  for (const token of String(spec).split(/[\s,]+/).filter(Boolean)) {
    const driver = /^([()*])<<(\d+)>>$/.exec(token);
    const number = /^<<(\d+)>>$/.exec(token);
    if (driver) out.push({ kind: "name", variant: driver[1], arg: Number(driver[2]) });
    else if (number) out.push({ kind: "number", arg: Number(number[1]) });
    else out.push({ kind: "wav", name: token });
  }
  return out;
}

/** The clip for a driver name in a voice: `*` the first of the truck's three wave files, `(` the second, `)` the third. */
export function nameClip(waves, variant) {
  const index = variant === "*" ? 0 : variant === "(" ? 1 : 2;
  return waves?.[index] ?? null;
}

/** The phrase's arguments as the driver numbers it names (1-based), in order of first use. */
export function specArgs(spec) {
  return [...new Set(parseSpec(spec).filter((t) => t.kind === "name").map((t) => t.arg))];
}

/**
 * The game's shuffle bag (RANDGEN, 0x421ef0): items in a list; each draw walks a random number of places along it,
 * takes the item there and moves it to the back, so the last ones drawn are the least likely to come again soon.
 */
export function createBag(items, random = Math.random) {
  const order = [...items.keys()];
  return () => {
    if (order.length < 2) return items[order[0] ?? 0];
    let at = 0;
    for (let tries = 0; tries < 100; tries++) {
      if (Math.floor(random() * 4) === 0) break;
      at = at + 1 >= order.length - 1 ? 0 : at + 1;
    }
    const [index] = order.splice(at, 1);
    order.push(index);
    return items[index];
  };
}

/**
 * The game's queue (0x4213a0): `add` a phrase for a group with its arguments (`GROUPS` gives its figures, `delay` 0);
 * `tick(dt, speaking)` once a frame returns the phrase to say now, or null. The silence counts up only while nothing
 * is said. Ready phrases go lowest priority first, then the one longer past its delay, then the one with less life.
 * `groups` and `silenceScale` come from `commentaryTables` (CP3 needs only 60% of each silence).
 */
export function createCommentaryQueue({ summit = false, groups = GROUPS, silenceScale = 1 } = {}) {
  const slots = [];
  let silence = 0;
  return {
    add(group, args, extra = {}) {
      const g = groups[group];
      if (!g || g.now || slots.length >= QUEUE_SLOTS) return false;
      slots.push({
        group, args, extra, priority: g.priority, delay: 0, life: g.life,
        silence: (summit && g.summitSilence !== undefined ? g.summitSilence : g.silence) * silenceScale,
      });
      return true;
    },
    tick(dt, speaking) {
      for (const s of slots) { s.delay -= dt; s.life -= dt; }
      for (let i = slots.length - 1; i >= 0; i--) if (slots[i].life <= 0) slots.splice(i, 1);
      if (speaking) { silence = 0; return null; }
      silence += dt;
      const ready = slots.filter((s) => s.delay <= 0 && silence >= s.silence);
      if (!ready.length) return null;
      ready.sort((a, b) => a.priority - b.priority || a.delay - b.delay || a.life - b.life);
      const next = ready[0];
      slots.splice(slots.indexOf(next), 1);
      return next;
    },
    get size() { return slots.length; },
    get silence() { return silence; },
  };
}

/**
 * Each group's shuffle bag. `pick(group, ctx)` draws the next phrase and returns it, or null when the line drawn may
 * not be said: `ctx.camera` the truck the camera follows is in the event (and close, for move and pass);
 * `ctx.passedLeader` the truck passed had the lead; `ctx.nearFinish` past three quarters of the lap, not a Summit
 * Rumble. A phrase naming a driver the event has none for is not said either. The phrase comes back with `args`, the
 * drivers it names in its own order (`phraseArgs`), and `numbers` (`ctx.numbers`, figure by argument) when the event
 * has any. `phrases` is the table to draw from (`commentaryTables`).
 */
export function createPhrasePicker(random = Math.random, phrases = PHRASES) {
  const bags = new Map();
  return {
    pick(group, ctx = {}) {
      if (!phrases[group]) throw new Error(`Unknown phrase group "${group}"`);
      if (!bags.has(group)) bags.set(group, createBag(phrases[group], random));
      const phrase = bags.get(group)();
      if (phrase.camera && !ctx.camera) return null;
      if (phrase.when && !ctx[phrase.when]) return null;
      const args = phraseArgs(phrase, ctx.args ?? []);
      if (specArgs(phrase.script).some((n) => !(args[n - 1] >= 1))) return null;
      if (ctx.numbers) return { ...phrase, args, numbers: ctx.numbers };
      return { ...phrase, args };
    },
  };
}

/** The drivers a phrase names, in its own order: the event's (`eventArgs`), or those its `of` picks from them. */
export function phraseArgs(phrase, eventArgs) {
  return phrase.of ? phrase.of.map((k) => eventArgs[k - 1]) : [...eventArgs];
}

/**
 * The text of a phrase: `text` (the line, with `<<1>>` and `<<2>>`) with the drivers' names put in; `names[n - 1]`
 * is the nth driver's.
 */
export function phraseText(text, names) {
  return String(text).replace(/<<(\d+)>>/g, (_, n) => names[Number(n) - 1] ?? "");
}

/** How long a line stays on screen after the game (0x414660): one second and a thirty-second per character. */
export function textSeconds(text) {
  return 1 + String(text).length / 32;
}
