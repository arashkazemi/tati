
## Kensakan
### A Tool for Stepping Through Javascript Code without the Browser's Inspector

---

Kensakan is a javascript library that makes it possible to debug, step,
pause and watch local variables in javascript code without using browser's
internal inspector. It works by restructuring and running the given code 
asynchronously. It can even step into the for loop test and update statements 
or follow the execution inside try-catch blocks and arrow functions.

This can be used in online development environments, testing, debugging,
and even education. The API is designed to make things as easy as possible 
while keeping it simple.

---

You can see a demo of Kensakan at
[https://arashkazemi.github.io/kensakan/](https://arashkazemi.github.io/kensakan/)

The latest source code of Kensakan can be found at
[https://github.com/arashkazemi/kensakan](https://github.com/arashkazemi/kensakan)

To use in other node projects, install kensakan from npm public repository:

        npm install kensakan  

and then in your javascript code:

        const Kensakan = require("kensakan");

To use in a webpage, first download the source code and extract it. The minified 
script itself is available in the `/dist` directory and the documentation 
can be found in the `/docs` and also in the source files. 

As a simple example Kensakan can be used like this:

        var k = new Kensakan (
                                function(r,c,ws) {return true;}
                             );

        k.prepare("console.log(1);\nconsole.log(2);\nconsole.log(3);\n");
        k.set_breakpoint(2);

        k.debug(true); // runs until reaching the breakpoint on line 2 
                       // (output:  1) 
        k.continue();  // runs until end as there is no other breakpoints 
                       // (output:  2,3)

Kensakan is also able to set the script context. This can be used to setup
environment or even mask global objects like `document` or `window`. For example
calling

        k.set_context({document: null, window: null, foo: 123});

before calling the `prepare` function will mask both `document` and `window`
objects and also introduces a foo variable that can be accessed anywhere in
the target script.

To know more about using Kensakan, see the included example and the class 
documentation.

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


And meanwhile, if you enjoy please support this project by donating, 
Many Thanks! <a style="background: #41a2d8 url(https://donorbox.org/images/red_logo.png) no-repeat 37px;color: #fff;text-decoration: none;font-family: Verdana,sans-serif;display: inline-block;font-size: 16px;padding: 15px 38px;padding-left: 75px;-webkit-border-radius: 2px;-moz-border-radius: 2px;border-radius: 2px;box-shadow: 0 1px 0 0 #1f5a89;text-shadow: 0 1px rgba(0, 0, 0, 0.3);" href="https://donorbox.org/kensakan?default_interval=o&amount=30">Donate</a>

---

Copyright (C) 2022 Arash Kazemi <contact.arash.kazemi@gmail.com>

Kensakan project is subject to the terms of BSD-2-Clause License. See the `LICENSE` file for more details.
