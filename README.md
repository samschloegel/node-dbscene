# dbscene

Welcome to dbscene, an Open Sound Control utility for scene store/recall integration between d&amp;b audiotechnik's [DS100](https://www.dbaudio.com/global/en/products/processing-matrix/ds100/) and Figure53's [QLab](https://qlab.app/).

**DISCLAIMER**: I am a live sound person, NOT a software developer. I am very new to Node, JavaScript, Git, and frankly coding in general. If the code in this project is a mess, or looks ridiculous, sorry about that.

If you think you might want to use this package, but have some questions or need help, please [email me](mailto:samsdomainaddress@gmail.com) - I would love to hear from you.

---

# Installation

```
npm install dbscene
```

If you're interested in trying this out but do not have a DS100 readily available for testing it, you can use [fakeds100](https://github.com/samschloegel/fakeDS100), a node app that will reply to object position requests for testing purposes.

---

# Initial Setup

Require the package in your code:

```js
const Dbscene = require('dbscene');
```

Initialize your instance of dbscene:

```js
const dbscene = new Dbscene(config, cache);
```

`config` and `cache` are required. See below.

## Config

Config is a copy of the following object:

```js
{
  qlab: {
    address: "localhost", // The IP address of your QLab machine
    ds100Patch: 1, // Your patch number
    defaultDuration: 0.2 // Your choice of duration, in seconds
  },
  ds100: {
    address: "10.0.1.100", // Ihe IP address of your DS100
    defaultMapping: 1 // See below
  },
	logging: 0 // 0 - Critical Only; 1 - Some logging; 2 - More logging
}
```

- `qlab.ds100Patch` sets the QLab Network Patch of the DS100.
- `qlab.defaultDuration` sets the length in seconds of each new "Network" cue created in QLab.
- All object coordinates sent to a DS100 are on a "Mapping", for which a default is defined here in `ds100.defaultMapping`. See [d&b documentation](https://www.dbaudio.com/global/en/products/processing-matrix/ds100/#tab-downloads) for more information.

## Cache

```js
[
  {
    num: 1,
    name: 'Homer',
    x: 0.0,
    y: 0.0,
  },
  {
    num: 2,
    name: 'Marge',
    x: 0.0,
    y: 0.0,
  },
];
```

The cache is an array of Javascript objects representing Soundscape objects.
Each object has a `num` property which corresponds to its DS100 object number.
The `name` property is used when creating new cues in QLab. It can be a blank string if you prefer, but it is recommended to enter the same name as is used for the object in R1/ArrayCalc, to make the resulting QLab cues easier to manage.

---

# Definitions

## dbscenes

A **dbscene** is a QLab Group Cue containing a separate Network Cue for each object to be recalled.

Each dbscene's qname **must** begin with the prefix "dbscene: " (including the colon and space). This prefix will be added to each new dbscene automatically. Please add whatever name you'd like following the "dbscene: " prefix but **do not** remove it or cue update functionality will break.

## Position cues

**Position cues** are the QLab Network cues within a **dbscene** group cue. Each position cue will automatically be named "{Object #} - {Object name}: {x coordinate}, {y coordinate}". You can alter these qnames as you see fit, but your custom alterations may be overwritten if the /dbscene/update method is applied to them.

---

# OSC Methods

**Before using this package** you should be familiar with the basics of using OSC with QLab. You can find the official documentation [here](https://qlab.app/docs/v4/scripting/osc-dictionary-v4/).

**Before using this package** you should be familiar with the basics of using OSC to control the En-Scene features of d&b's DS100. You can download d&b's OSC implementation guide on [this page](https://www.dbaudio.com/global/en/products/processing-matrix/ds100/#tab-downloads).

## /**dbscene**

### /dbscene/**create**

Creates a new dbscene at the selection point by sending a series of OSC commands to QLab.

### /dbscene/**update**

In QLab, select the dbscene cues you wish to update. You may select dbscene group cues, or dbscecne network cues within them.
With the cues selected, send /dbscene/update to update the selected cues. The simplest way to do this is likely with a hotkey from within QLab itself.

---

## "That's all, folks"

That's all for now. Hopefully more to come sometime soon.

If you'd like to leave feedback or make a feature request, please [submit an issue](https://github.com/samschloegel/node-dbscene/issues) or [send me an email](mailto:samsdomainaddress@gmail.com).
