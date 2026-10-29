/*
  The Monster Manual: OpenMTM2's own guide to the game, in its own words. Its chapters follow the topics of the game's
  help file (`MONSTER.HLP`, "Monster Manual 2.0"), rewritten for OpenMTM2 in a browser; nothing of the original's text
  is used. Each paragraph is a message tag (game/strings.js), shown through `t`, so it translates like the rest.

  A topic's `body` lists paragraphs (strings), `{ list: [...] }` bullet lists, and `{ keys: [[action, label], ...] }`
  tables, whose keys are read from the player's own bindings (game/input/bindings.js) when shown; `{ fixed: [[keys,
  label], ...] }` tables are keys that cannot be changed; `{ extensions: true }` lists the extension modes with their
  own names and descriptions (game/extensions/loader.js), so a new mode appears without a change here.
*/
import { msg } from "../game/strings.js";

export const MANUAL = Object.freeze([
  {
    title: msg("Getting started"),
    topics: [
      {
        id: "overview", title: msg("Racing overview"),
        body: [
          msg("OpenMTM2 plays Monster Truck Madness 2 from your own copy of the game, in the browser. Pick the game's folder once; its archives are copied into the browser's storage and every race is read from there."),
          msg("You can race the computer's trucks on any installed track, play with friends online, or try the modes OpenMTM2 adds to the game."),
        ],
      },
      {
        id: "start-race", title: msg("Starting a race"),
        body: [
          { list: [
            msg("On the Start screen, click Driver Check-in."),
            msg("Type a new name or pick yours, choose a skill level and a truck."),
            msg("Click Races and pick a track. The number beside it is the laps, or the minutes of a Summit Rumble."),
            msg("Choose the weather, and click Computer Opponents to choose the trucks you race against."),
            msg("Click Go."),
          ] },
        ],
      },
      {
        id: "pause", title: msg("Pausing, restarting and leaving a race"),
        body: [
          msg("Press the Pause key to stop the race. The pause menu resumes it, restarts it, shows the instant replay, opens the options or ends the race."),
          msg("Ending a race takes you to the Winner's Circle with the results so far."),
        ],
      },
    ],
  },
  {
    title: msg("Controls"),
    topics: [
      {
        id: "driving", title: msg("Driving"),
        body: [
          msg("With automatic shifting (Options, Game) the truck changes gear by itself: hold Brake to stop, and keep holding it to back up. Without it, shift up and down yourself, through reverse and neutral."),
          { keys: [["accelerate", msg("Accelerate")], ["brake", msg("Brake")], ["left", msg("Turn Left")], ["right", msg("Turn Right")], ["shiftUp", msg("Shift Up")], ["shiftDown", msg("Shift Down")]] },
          msg("A gamepad drives the same way: the stick or the triggers for the pedals, the stick for steering. Options, Controls changes any key."),
        ],
      },
      {
        id: "keys", title: msg("Keys in a race"),
        body: [
          { keys: [
            ["helicopter", msg("Call the rescue helicopter")], ["horn", msg("Horn")], ["yeehaw", msg("YeeHaw")],
            ["camera", msg("Next view (with Shift, the view before)")], ["map", msg("Course map: on, with names, off")],
            ["names", msg("Names over the trucks")], ["finder", msg("Checkpoint finder")], ["dashboard", msg("Dashboard")],
            ["hud", msg("Timing display")], ["headlights", msg("Headlights")], ["crashDamage", msg("Crash damage on and off (off repairs every truck)")],
            ["pause", msg("Pause")],
          ] },
          { fixed: [["1 - 9, 0", msg("Pick one of the ten views")], ["Backspace", msg("Look back while held")]] },
        ],
      },
      {
        id: "helicopter", title: msg("The rescue helicopter"),
        body: [
          msg("Stuck on your roof, lost off the course or wedged against a wall? Call the helicopter. It lifts the truck, rights it and sets it down on the course near where you left it."),
        ],
      },
    ],
  },
  {
    title: msg("Views"),
    topics: [
      {
        id: "cab", title: msg("Looking around from the cab"),
        body: [
          msg("In the cockpit view, hold a View key to look out of the side windows or the back; let go to look ahead again. With the head turned you see only the cab, as the game drew it."),
          { keys: [["viewLeft", msg("Look left")], ["viewRight", msg("Look right")], ["cameraDown", msg("Look behind")], ["cameraUp", msg("Rear-view mirror on and off")]] },
          msg("The mirror starts off, as it did in the game. The Dashboard key goes round the full cockpit, the gauges alone, and no dashboard."),
        ],
      },
      {
        id: "external", title: msg("The external views"),
        body: [
          msg("Chase Near and Chase Far follow the truck from behind, nearer or farther. Chase Front, Left and Right look at it from those sides, and the two Big views fill the screen with it."),
          msg("BlimpCam watches from the blimp over the course. RaceCam picks the trackside camera nearest the truck, as television does."),
          msg("The Camera key, or a digit, picks a view. In a chase view the View keys swing the camera round the truck and tilt it; choosing a view puts it back."),
          { keys: [["viewLeft", msg("Camera to the left")], ["viewRight", msg("Camera to the right")], ["cameraUp", msg("Camera higher")], ["cameraDown", msg("Camera lower")]] },
          msg("The mouse looks round as well, and its wheel zooms; Options, Advanced has the switches."),
        ],
      },
      {
        id: "map", title: msg("The course map and the names"),
        body: [
          msg("The Map key shows the course from above, turning with your truck, with every truck on it and its place; press it again for the drivers' names, and once more to hide it."),
          msg("The Names key labels the trucks themselves, with their names or their drivers'."),
        ],
      },
    ],
  },
  {
    title: msg("Before the race"),
    topics: [
      {
        id: "skill", title: msg("Skill levels"),
        body: [
          msg("Rookie trucks forgive a lot and the computer's drivers make mistakes. Intermediate trucks are faster and handle like the real thing. Professional trucks are faster still, and the computer drives to win."),
        ],
      },
      {
        id: "garage", title: msg("The Garage"),
        body: [
          msg("Tune your truck before a race. A deeper tire cut grips soft ground better; a stiffer suspension holds the truck flatter in turns and on landings; the transfer gear trades acceleration for top speed."),
          msg("A track with big jumps wants a higher transfer setting, so the truck reaches the ramps fast enough."),
        ],
      },
      {
        id: "aids", title: msg("Driving aids and opponents"),
        body: [
          msg("Options, Game has automatic shifting and the autopilot, which can work the pedals or drive the whole way. It also sets how many computer opponents a new race starts with, up to seven."),
        ],
      },
      {
        id: "weather", title: msg("Weather and time of day"),
        body: [
          msg("Each track lists the weather it allows: clear, cloudy, fog, dense fog, rain, snow, dusk, night and pitch black, or Random. Rain and snow make the ground slippery; the others change only what you can see. In the dark, switch your headlights on."),
          msg("In the rain the cockpit has its own sound: the rain on the roof, out in the open."),
        ],
      },
      {
        id: "damage", title: msg("Crash damage"),
        body: [
          msg("With crash damage on, trucks dent where they hit things, and a knock can turn a headlight askew. The Crash Damage key switches it off again, and that repairs every truck."),
        ],
      },
    ],
  },
  {
    title: msg("The races"),
    topics: [
      {
        id: "circuits", title: msg("Circuits and rallies"),
        body: [
          msg("Pass through every checkpoint, in order, on every lap. Miss one and the lap does not count: the finder points you back to it."),
          msg("The finder ring shows the next checkpoint's number, with a dot that circles to its direction; it turns green when you are headed straight for it."),
          msg("The timing display shows the lap, the best lap, the race clock, the gap to the truck ahead (or the lead), your place and the lap count."),
        ],
      },
      {
        id: "rumble", title: msg("Summit Rumbles"),
        body: [
          msg("King of the hill: hold the scoring zone on the summit for as long as you can, and knock the others off."),
          { list: [
            msg("10 points for each second in the scoring zone."),
            msg("1 point lost for each second off the summit."),
            msg("50 points lost each time you fall or are pushed off it."),
          ] },
          msg("The Timing display key shows the standings: every truck's score, the leader first."),
        ],
      },
      {
        id: "scoring", title: msg("Points and the Hall of Fame"),
        body: [
          msg("A race pays 900, 700, 500, 400, 300, 200, 150 and 100 points for the places. In a race of more than one lap the fastest lap earns 100 more, and the winner 100 divided by the number of laps."),
          msg("The Hall of Fame keeps the best results of every track. Options, Data imports the game's own drivers and Hall of Fame (player.pro and MTM2 High Scores from its folder) and saves OpenMTM2's in the same files."),
        ],
      },
    ],
  },
  {
    title: msg("OpenMTM2's own modes"),
    topics: [
      {
        id: "modes", title: msg("Extension modes"),
        body: [
          msg("Besides Circuit, Rally and Summit Rumble, OpenMTM2 has modes of its own, which the original game never had. Pick one in the Mode list on the Races screen; the tracks it can be played on are listed for it, and the number beside the track becomes its own length: minutes, laps or goals."),
          msg("Options, Extensions holds each mode's settings, such as its teams, time limits and rules. The modes for several trucks play in online rooms too, judged on the room owner's machine; Freestyle is driven alone."),
          { extensions: true },
        ],
      },
      {
        id: "teams", title: msg("Teams and roles"),
        body: [
          msg("In Hockey, Soccer, Combat and Race & Rumble the Computer Opponents dialog puts each truck, yours included, on a team or in a role, such as a racer or a blocker in Race & Rumble. A truck left unpicked is placed by the mode."),
          msg("The names over the trucks show their team or role, and the mode's own score and calls are on the screen during the game and in the Winner's Circle after it."),
        ],
      },
    ],
  },
  {
    title: msg("Instant replay"),
    topics: [
      {
        id: "replay", title: msg("Watching and saving replays"),
        body: [
          msg("Every race is recorded. Pause and choose Instant Replay, or click Instant Replay in the Winner's Circle, to play it with the VCR buttons from any truck and any view."),
          msg("Save keeps the replay as a .rpl file that Monster Truck Madness 2 and Community Patch 3 can play as well. Options, Instant Replay opens a saved one, the game's included."),
        ],
      },
    ],
  },
  {
    title: msg("Playing with others"),
    topics: [
      {
        id: "online", title: msg("Online rooms"),
        body: [
          msg("Multiplayer, Online rooms creates a room and gives you a code and a link to send. Everyone in the room races together; the room's owner picks the track and starts the race."),
          msg("Press Enter in a race to chat, or K to chat to your team in a team mode. Tab changes who the line goes to, Page Up and Page Down scroll back through the last 20 lines, and /help lists the commands (/w to whisper, /r to reply, /mute). With a gamepad, hold View and point the right stick at a quick message. Options, Multiplayer sets how much chat shows over the race."),
        ],
      },
    ],
  },
  {
    title: msg("Troubleshooting"),
    topics: [
      {
        id: "trouble", title: msg("If something does not work"),
        body: [
          { list: [
            msg("No sound: browsers start sound only after a click or a key. Check the volumes in Options, Sound."),
            msg("The race is slow: lower the draw distance in Options, or choose a lighter Scenery preset."),
            msg("A gamepad does nothing: press one of its buttons once the page is open, so the browser lets the game see it."),
            msg("A track will not load: OpenMTM2 lists what it could not find. Options, Data, Reload POD.INI copies the game's archives again."),
          ] },
        ],
      },
    ],
  },
]);
