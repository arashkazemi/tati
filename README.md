
## Tati
### A Javascript Debugger without Using the Built-in Runtime Inspector

---

Tati is a javascript library that makes it possible to debug, step,
pause and watch local variables in javascript code without using the built-in
runtime inspector. It can even step into the for loop test and update statements 
or follow the execution inside try-catch blocks and arrow functions. Tati is 
even able to pause and step through intervals and timeouts.

Tati provides methods to define, modify and access runtime context and mask 
global variables even the globalThis, so the interaction between the debugged 
script and the environment can be controlled precisely. 

Debugging using Tati is different from using the internal inspector (and 
perhaps from any other debugger on the planet!), as with Tati the runtime isn't 
paused on breakpoints. So the code is basically running but a part of it is 
selectively stepped through, paused and analyzed.

Another aspect of Tati is the possibility of having multiple debuggers
running on different parts of the script, each having their own breakpoints,
watches, and each may be paused separately. See the dual debugger example for
more details.

The only caveat of using Tati is that because of the synchronous nature of
debugging and stepping, every call is awaited. So the code that is given to Tati 
will `await` every promise to be resolved or failed. This doesn't affect the code 
that is being imported or the functions that are defined outside of code debugged 
by Tati so those promises will all work as expected.

Tati can be used in debugging, testing, online development environments,
and even education. The API is designed to make things as easy as possible 
while keeping it powerful and flexible.

---

You can see a demo of Tati at
[https://arashkazemi.github.io/tati/](https://arashkazemi.github.io/tati/)

The latest source code of Tati can be found at
[https://github.com/arashkazemi/tati](https://github.com/arashkazemi/tati)

To use in other node projects, install tati from npm public repository:

        npm install tati  

and then in your javascript code:

        const Tati = require("tati");

To use in a webpage, first download the source code and extract it. The minified 
script itself is available in the `/dist` directory and the documentation 
can be found in the `/docs` and also in the source files. 

It is also available via unpkg CDN and can be included in HTML files using

        <script src="https://unpkg.com/tati/dist/tati.min.js"></script>
        
As a simple example Tati can be used like this:

        var t = new Tati (
                                function(r,c,ws) {return true;}
                             );

        t.prepare(
                `console.log(1);
                 console.log(2);
                 console.log(3);
                 console.log(4);
                 `);
        t.setBreakpoint(2);
        t.setBreakpoint(3);

        t.debug(true); // runs until reaching the breakpoint on line 2 
                       // (output:  1) 
        t.continue();  // runs until reaching the breakpoint on line 3 
                       // (output:  2) 
        t.continue();  // runs until end as no breakpoint remains
                       // (output:  3,4)

To know more about using Tati, see the included example and the for the details
see the class documentation.

To build the project from scratch open a terminal in the root directory
of the extracted files. Then to install the dependencies, run:

        npm install

Then you will be able to see the example `index.html` in action by 
running:

        npm run http

To build and pack the script again run:

        npm run build

And to regenerate the documentation pages run:

        npm run jsdoc

---

Copyright (C) 2022-2024 Arash Kazemi <contact.arash.kazemi@gmail.com>. All rights reserved.

Tati project is subject to the terms of BSD-2-Clause License. See the `LICENSE` file for more details.
