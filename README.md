
## Kensakan
### A Tool for Stepping in Javascript Code without the Inspector

---

Kensakan is a javascript library that makes it possible to debug, step,
pause and watch local variables in javascript code without using browser's
internal inspector. It works by restructuring and running the given code in 
an async manner, and interacting with it using its own async function 
calls. It can even step into the for loop test and update statements or
follow the execution inside try-catch blocks and inline functions.


This can be used in online development environments, testing, debugging,
and even education. The API is designed to make things as easy as possible 
while keeping it simple.

For a detailed example that is also integrated with ace.js editor see
`index.html`. Although Kensakan doesn't need ace editor, and its
dependencies (esprima and escodegen) are bundled in the distribution
version. So the only file you need to import is `kensakan.min.js`.

---

The latest source code of Kensakan can be found in:
[https://github.com/arashkazemi/kensakan](https://github.com/arashkazemi/kensakan)

To use, first download the source code, then extract it. The minified 
script itself is available in the `/dist` directory and the documentation 
can be found in ths `/docs` directory and also in the source files.

To build the project from scratch open a terminal in the root directory
of the extracted files. Then to install the dependencies, run:

        npm install

Then you will be able to see the example `index.html` in action by 
running:

        npm run http

To build and pack the script again run:

        npm run build

 And to regenrate the documentation pages run:

        npm run jsdoc
        
And meanwhile, if you enjoy, please support this project by donating to this link, 
Many Thanks! <a style="background: #41a2d8 url(https://donorbox.org/images/red_logo.png) no-repeat 37px;color: #fff;text-decoration: none;font-family: Verdana,sans-serif;display: inline-block;font-size: 16px;padding: 15px 38px;padding-left: 75px;-webkit-border-radius: 2px;-moz-border-radius: 2px;border-radius: 2px;box-shadow: 0 1px 0 0 #1f5a89;text-shadow: 0 1px rgba(0, 0, 0, 0.3);" href="https://donorbox.org/kensakan?default_interval=o&amount=30">Donate</a>

---

Copyright (C) 2022 Arash Kazemi <contact.arash.kazemi@gmail.com>

Kensakan project is subject to the terms of BSD-2-Clause License. See the `LICENSE` file for more details.


