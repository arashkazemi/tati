/* 

  Kensakan 
  A Tool for Stepping Through Javascript Code without the Browser's Inspector

  Copyright (C) 2022 Arash Kazemi <contact.arash.kazemi@gmail.com>
  
  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/



const esprima = require("esprima");
const escodegen = require("escodegen");

let ____kensakan_is_browser____ = new Function("try {return this===window;}catch(e){ return false;}");

class Kensakan {

  /**
   * Creates an instance of Kensakan.
   * There can be multiple instances and each can be controlled separately.
   * 
   * @constructor
   * 
   * @param {function} step_callback - The callback handler for stepping. It is 
   *        called before the runner runs a breakpoint or steps to the next line. 
   *        The row and column of the next step is given as the first and second 
   *        arguments. If the watch flag is set, a third argument of watches values
   *        is also passed to the callback. The watched values is a dictionary, 
   *        containing values of the local variables before running that step. If a 
   *        variable is shadowed by another, the most recent value is shown.
   * 
   * If the step callback returns true, the execution will be paused until
   * one of the functions `step()` or `continue()` is called. If it returns 
   * false the execution continues to the step or breakpoint.
   * 
   * @param {function} stop_callback - Is called when the running of the code is 
   *        finished.
   * 
   * @param {function} error_callback - Is called when there is an error in
   *        parse or run time. The first and second arguments are the line and
   *        column, third argument would be the type of error (parse
   *        or runtime), and the forth would be the error description. 
   * 
   * In case of parser errors, if error_callback argument is given to the constructor, 
   * Kensakan will call it.
   *
   * In case of runtime errors, if error_callback argument is given to the constructor, 
   * Kensakan will call it. But it will not cancel the event or stop its propagation so it 
   * doesn't interfere with any other code handling mechanism. 

   * @param {boolean} step_loop_args - If set, it will also step into 
   *        loop test and update expressions, see {@link Kensakan#step_loop_args}
   */

  constructor(  step_callback=null, 
                stop_callback=null, 
                error_callback=null, 
                step_loop_args=true,
                use_worker=false ) 
  {

    /**
     * Set the breakpoint lines in this object to 
     * anything other than false or null, like:
     * 
     *         var k = new Kensakan (
     *                function(r,c,ws) {return true;}
     *              );
     *     
     *         k.prepare("console.log(1);\nconsole.log(2);\nconsole.log(3);\n");
     *         k.set_breakpoint(2);
     *     
     *         k.debug(true); // runs until reaching the breakpoint on line 2 
     *                        // (output:  1) 
     * 
     *         k.continue();  // runs until end as there is no other breakpoints 
     *                        // (output:  2,3)
     */

    this.breakpoints = {};


    /**
     * If set, Kensakan will also step into 
     * loop test and update expressions, like `i<n` and `i++` in the loop:
     * 
     *            for( let i=0; i<n; i++ ) {...}
     * 
     * You can set step_loop_args, but should call prepare after so it can 
     * be applied.
     */
    this.step_loop_args = step_loop_args;



    // PRIVATE STUFF

    this.id = Kensakan.prototype.instances.length;
    Kensakan.prototype.instances.push(this);

    var perr = Kensakan.prototype.error_proxy.bind(this);

    if(____kensakan_is_browser____()) {
      window.addEventListener("unhandledrejection", perr);
    }
    else {
      process.on('unhandledRejection', perr);
    }

    this.esp = null;
    
    this.step_callback = step_callback;
    this.stop_callback = stop_callback;
    this.error_callback = error_callback;
    this.resolve = null;
    this.run_to_breakpoint = false;

    this.last_column = -1;
    this.last_row = -1;

    this.error = null;

    this.context = {};

    this.run_func = null;
    this.debug_func = null;

    this.__esprima__ = esprima;
    this.__escodegen__ = escodegen;

    this.worker = null;
        
    if(use_worker) {
      this.worker = new Worker
    }
  }

  
  /**
   * Parses the given code, and prepares it for the flow with control,
   * throws exception if there is a syntax problem in code.
   * 
   * @param {string} code - The javascript code to compile/run.
   * 
   * @param {boolean} watch_locals - If set, the callback will receive a
   * snapshot of the local variables in an object too.
   */

  prepare( code, watch_locals=true ) 
  {
    var ws = watch_locals ? [[]] : null;

    try {
      this.esp = esprima.parse( code, {loc:true} );
    }
    catch(e) {
      if(this.error_callback!=null) {
        this.error_callback(e.lineNumber, e.column, "parse", e.description);
      }
      this.error = e;
    }

    let ctx = Object.keys(this.context).join(',');

    this.run_func = eval(`(async function(${ctx}) { ${escodegen.generate(this.esp)} })`);

    this.asyncize(this.esp);
    this.kensakize(this.esp, ws);

    this.debug_func = eval(`(async function(${ctx}) { ${escodegen.generate(this.esp)} })`);
  };


  /**
   * Runs the prepared code as it is, **without** the debug codes. 
   * The only difference is that it is asyncized anyway, so the flow of
   * the two debug/release procedures would be the same.                
   */

  run() 
  {
    if(this.run_func==null) return;

    this.run_func(...Object.values(this.context)).then( (function() {

      if(this.stop_callback!=null) {
        this.stop_callback();
      }

      this.last_row=-1;
      this.last_column=-1;

    }).bind(this) );
  }


  /**
   * Runs the prepared code **with** the debug codes. 
   * You can step line by line or run until reaching a breakpoint. It will 
   * call the `step_callback` that was given to constructor.
   * 
   * @param {boolean} run_to_breakpoint - If true it will continue running 
   * until reaching a breakpoint. If false, it will step line by line.
   */

  debug(run_to_breakpoint=false) 
  {
    if(this.debug_func==null) return;

    this.run_to_breakpoint = run_to_breakpoint;

    this.debug_func(...Object.values(this.context)).then( (function() {

      if(this.stop_callback!=null) {
        this.stop_callback();
      }
      
      this.last_row=-1;
      this.last_column=-1;

    }).bind(this) );
  }

  /**
   * Steps to the next line/expression.
   * It will call the `step_callback` that was given to constructor.
   */

  step() 
  {
    this.run_to_breakpoint = false;
    if(this.resolve!=null) {
      this.resolve(true);
    }
  }

  /**
   * Runs to the next breakpoint or end.
   * It will call the `step_callback` that was given to constructor on 
   * reaching a breakpoint.
   */

  continue() 
  {
    this.run_to_breakpoint = true;
    if(this.resolve!=null) {
      this.resolve(true);
    }
  }

  /**
   * Sets a breakpoint on the given line.
   */

  set_breakpoint(line) {
    this.breakpoints[''+line] = true;
  }

  /**
   * Clears the breakpoint on the given line.
   */

  clear_breakpoint(line) {
    delete this.breakpoints[''+line];
  }


  /**
   * Clears all the breakpoints.
   */

  clear_all_breakpoints() {
    this.breakpoints = {};
  }

  /**
   * Sets context variables. The members of the context object will be set
   * as given in this object. This also can be used to mask global browser
   * objects like document and window, i.e. 
   * 
   *     k.set_context({document: null, window: null});
   * 
   * This function should be called before prepare. But if the values of 
   * context members are changed later, there is no need to call prepare
   * again. You only should call prepare again if the keys of the context
   * are changed later. You can also access context directly, i.e. 
   * 
   *     k.context.x = 1;
   */

  set_context(context) {
    this.context = context;
  }


  /* Internal functions */

  wrap(a, ws) 
  {

    this.kensakize( a, ws );

    if(a.type!="BlockStatement" && a.type!="CatchClause") {
      var el = {
        "type": "BlockStatement",
        "body": [ Kensakan.prototype.template_block(this.id, a, ws), a ]
      };

      return el;
    }

    return a;
  };

  kensakize(a,ws) 
  {
    if( a==null ) return null;
    if( typeof(a.type)=="undefined" ) return;

    if(ws!=null && a.type=="BlockStatement") ws=[ws];

    if( a.type=="Program" || 
        a.type=="BlockStatement" ) 
    {
      for(var i=0; i<a.body.length; i++) {

        var abi = a.body[i];

        if( abi.type!="BlockStatement" &&
          abi.type!="FunctionDeclaration" &&
          abi.type!="DoWhileStatement" ) {

          var el =  Kensakan.prototype.template_block(this.id, abi, ws);
          if(typeof(el)==typeof(undefined)) continue;

          a.body.splice(i,0,el);
          i++;
        }

        this.kensakize( abi, ws );
      }
    }
    else if(a.type=="ForStatement") {

      if(this.step_loop_args) {
        //var ai = a.init;
        this.kensakize(a.init, ws);
        //a.init = ai;
        a.test = Kensakan.prototype.template_inline(this.id, a.test, ws);
        a.update = Kensakan.prototype.template_inline(this.id, a.update, ws);
      }

      a.body = this.wrap(a.body, ws);
    }
    else if(a.type=="DoWhileStatement" || 
            a.type=="WhileStatement" )
    {
      if(this.step_loop_args) {
        a.test = Kensakan.prototype.template_inline(this.id, a.test, ws);
      }

      a.body = this.wrap(a.body, ws);
    }
    else if(a.type=="FunctionDeclaration" || 
            a.type=="FunctionExpression" ||
            a.type=="ForInStatement" ||
            a.type=="ForOfStatement" ||
            a.type=="CatchClause" ||
            a.type=="WithStatement") 
    {
      if( a.type=="FunctionDeclaration" || 
          a.type=="FunctionExpression") {

        for(var j=0; j<a.params.length; j++) {
          if(ws!=null)
            ws.push(a.params[j].name);
        }       
      }
      a.body = this.wrap(a.body, ws);
    }
    else if(a.type=="IfStatement") {
      if(a.alternate!=null) a.alternate = this.wrap(a.alternate, ws);
      if(a.consequent!=null) a.consequent = this.wrap(a.consequent, ws);
    }
    else if(a.type=="TryStatement") {
      if(a.block!=null) a.block = this.wrap(a.block, ws);
      if(a.handler!=null) a.handler = this.wrap(a.handler, ws);
      if(a.finalizer!=null) a.finalizer = this.wrap(a.finalizer, ws);
    }
    else if(a.type=="SwitchStatement") {

      for(var i=0; i<a.cases.length; i++) {

        var c = a.cases[i].consequent;

        for(var j=0; j<c.length; j++) {

          if( c[j].type!="BlockStatement" &&
            c[j].type!="FunctionDeclaration" &&
            c[j].type!="FunctionExpression" &&
            c[j].type!="DoWhileStatement" ) {

            var el = Kensakan.prototype.template_block(this.id, c[j], ws);

            c.splice(j,0,el);
            j++;
          }

          this.kensakize( c[j], ws );
        }
      }
    }
    else if(a.type=="VariableDeclaration") {
      for(var j=0; j<a.declarations.length; j++) {
        this.kensakize( a.declarations[j], ws );
      }
    }
    else {
      if(a.type=="VariableDeclarator") {
        if(ws!=null)
          ws.push(a.id.name);
      }

      for(let i in a) {
        if( Array.isArray(a[i]) ) {
          for(let j in a[i]) {
            this.kensakize( a[i][j], ws );
          }
        }
        else {
          this.kensakize( a[i], ws );
        }
      }
    }

    if(ws!=null && a.type=="BlockStatement") ws=ws[0];
  }

  asyncize(ast) {

    if(typeof(ast)=="object" ) {
      for(let el in ast) {
        this.asyncize(ast[el]);

        if(ast[el]!=null && typeof(ast[el].type)!="undefined") {

          if(ast[el].type=="CallExpression") {
            ast[el] = {
              "type": "AwaitExpression",
              "argument": ast[el]
            }
          }
          else if(ast[el].type=="FunctionDeclaration" || ast[el].type=="FunctionExpression") {
            ast[el].async=true;
          }
        }
      }
    }
  }


}



Kensakan.prototype.instances = [];

Kensakan.prototype.template_watch_args = async function(id,r,c) 
{

  let k = Kensakan.prototype.instances[id];
  let vals={};

  for(let i=3;i<arguments.length;i+=2) {
    if(arguments[i+1]==Kensakan.prototype.undefined) {
      vals[arguments[i]]=k.undefined;
    }
    else {
      vals[arguments[i]]=arguments[i+1];
    }
  }

  c++;

  k.last_column = c;
  k.last_row = r;

  if( k.run_to_breakpoint ) {

    if(k.breakpoints[r]) {
      if( k.step_callback(r,c,vals) ) {
        return new Promise(
                function(res,rej) {
                  k.resolve=res;
                }
            );
      }
    }

  }
  else {
    if( k.step_callback(r,c,vals) ) {
      return new Promise(
              function(res,rej) {
                k.resolve=res;
              }
          );
    }
  }
  return true;
}


Kensakan.prototype.template_no_watch_args = async function(id,r,c) 
{

  var k = Kensakan.prototype.instances[id];
  
  c++;

  k.last_column = c;
  k.last_row = r;

  if( k.run_to_breakpoint ) {

    if(k.breakpoints[r]) {
      if( k.step_callback(r,c) ) {
        return new Promise(
                function(res,rej) {
                  k.resolve=res;
                }
            );
      }
    }

  }
  else {
    if( k.step_callback(r,c) ) {
      return new Promise(
              function(res,rej) {
                k.resolve=res;
              }
          );
    }
  }
  return true;
}

Kensakan.prototype.template_generate_watch_args = function(ws)
{
  if(ws.length==0) return [];

  var wss=Kensakan.prototype.template_generate_watch_args(ws[0]);

  for(let i=1; i<ws.length; i++) {
    wss.push({
                "type": "Literal",
                "value": ws[i],
                "raw": "\""+ws[i]+"\""
              });

    wss.push({
              "type": "ConditionalExpression",
              "test": {
                "type": "BinaryExpression",
                "operator": "==",
                "left": {
                  "type": "UnaryExpression",
                  "operator": "typeof",
                  "argument": {
                    "type": "Identifier",
                    "name": ws[i]
                  },
                  "prefix": true
                },
                "right": {
                  "type": "Literal",
                  "value": "undefined",
                  "raw": "'undefined'"
                }
              },
              "consequent": {
                  "type": "Identifier",
                  "name": "Kensakan.prototype.undefined"
              },
              "alternate": {
                "type": "Identifier",
                "name": ws[i]
              }
            });
  }

  return wss;
}

Kensakan.prototype.template_block = function(id,el,ws)
{

  let res = {
              "type": "ExpressionStatement",
              "expression": {
                "type": "AwaitExpression",
                "argument": {
                  "type": "CallExpression",
                  "callee": {
                    "type": "Identifier",
                    "name": "Kensakan.prototype.template_no_watch_args"
                  },
                  "arguments": [
                    {
                      "type": "Literal",
                      "value": id,
                      "raw": "" + id
                    }, 
                    {
                      "type": "Literal",
                      "value": el.loc.start.line,
                      "raw": "" + el.loc.start.line
                    }, 
                    {
                      "type": "Literal",
                      "value": el.loc.start.column,
                      "raw": "" + el.loc.start.column
                    }
                  ],
                  "optional": false
                }
              }
            };

  if(ws!=null) {
    let wss = Kensakan.prototype.template_generate_watch_args(ws);
    res.expression.argument.callee.name="Kensakan.prototype.template_watch_args";
    res.expression.argument.arguments.push(...wss);
  }

  return res;
};

Kensakan.prototype.template_inline = function(id,el,ws)
{

  let res = {
              "type": "LogicalExpression",
              "operator": "&&",
              "left": {
                "type": "AwaitExpression",
                "argument": {
                  "type": "CallExpression",
                  "callee": {
                    "type": "Identifier",
                    "name": "Kensakan.prototype.template_no_watch_args"
                  },
                  "arguments": [
                    {
                      "type": "Literal",
                      "value": id,
                      "raw": "" + id
                    }, 
                    {
                      "type": "Literal",
                      "value": el.loc.start.line,
                      "raw": "" + el.loc.start.line
                    }, 
                    {
                      "type": "Literal",
                      "value": el.loc.start.column,
                      "raw": "" + el.loc.start.column
                    }
                 ],
                  "optional": false
                }
              },
              "right": el
          };

  if(ws!=null) {
    let wss = Kensakan.prototype.template_generate_watch_args(ws);
    res.left.argument.callee.name="Kensakan.prototype.template_watch_args";
    res.left.argument.arguments.push(...wss);
  }

  return res;
};


Kensakan.prototype.error_proxy = function(err)
{
  if(this.error_callback!=null) {
    this.error_callback(this.last_row, this.last_column, "runtime", err.reason.message);
  }
  this.error = err;

  this.last_row=-1;
  this.last_column=-1;
}

module.exports = Kensakan;