/* 

  Kensakan 
  A Tool for Stepping in Javascript Code without the Inspector

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

class Kensakan {

  /**
   * Creates an instance of Kensakan
   * There can be multiple instances and each can be controlled separately.
   * 
   * @constructor
   * 
   * @param {string} code - the javascript code to compile/run.
   * 
   * @param {function} step_callback - the callback handler for stepping, is 
   *        called when runner enters a breakpoint or steps to next line.
   *        If the step callback returns true, the execution will be paused until
   *        one of the functions `step()` or `continue()` is called. If it returns false
   *        the ececution continues to the step or breakpoint.
   * 
   * @param {function} stop_callback - is called when the function running is 
   *        finished.
   * 
   * @param {boolean} step_loop_args - if set, it will also step into 
   *        loop test and update expressions, see {@link Kensakan#step_loop_args}
   */

  constructor(  code="", 
                step_callback=null, 
                stop_callback=null, 
                step_loop_args=true ) 
  {

    /**
     * Set the breakpoint lines in this object to 
     * anything other than false or null, before calling prepare(), like:
     * 
     *         var k = new Kensakan (
     *                "console.log(1);\nconsole.log(2);\nconsole.log(3);\n",
     *                function(r,c,ws) {return true;}
     *              );
     *     
     *         k.breakpoints['2'] = true;
     *     
     *         k.debug(true); // runs until reaching the breakpoint on line 2 
     *                        // (output:  1) 
     * 
     *         k.continue() // runs until end as there is no other breakpoints 
     *                      // (output:  2,3)
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

    this.esp = null;
    
    this.step_callback = step_callback;
    this.stop_callback = stop_callback;
    this.resolve = null;
    this.run_to_breakpoint = false;

    this.prepare(code);
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

    this.esp = esprima.parse( code, {loc:true} );

    this.run_func = eval("(async function() {" + escodegen.generate(this.esp) + "})");
    this.asyncize(this.esp);
    this.kensakize(this.esp, ws);
    this.debug_func = eval("(async function() {" + escodegen.generate(this.esp) + "})");
  };


  /**
   * Runs the prepared code as it is, **without** the debug codes. 
   * The only ddifference is that it is asyncized anyway, so the flow of
   * the two debug/release procedures would be the same.                
   */

  run() 
  {
    this.run_func().then( this.stop_callback );
  }


  /**
   * Runs the prepared code **with** the debug codes. 
   * You can step line by line or run until reaching a breakpoint. It will 
   * call the `step_callback` that was given to constructor.
   * 
   * @param {boolean} run_to_breakpoint - if true it will continue running 
   * until reaching a breakpoint. if false, it will step line by line.
   */

  debug(run_to_breakpoint=false) 
  {
    this.run_to_breakpoint = run_to_breakpoint;
    this.debug_func().then( this.stop_callback );
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

Kensakan.prototype.template_watch_args = async function(bid,r,c) 
{

  let b = Kensakan.prototype.instances[bid];
  let vals={};

  for(let i=3;i<arguments.length;i+=2) {
    if(arguments[i+1]==Kensakan.prototype.undefined) {
      vals[arguments[i]]=b.undefined;
    }
    else {
      vals[arguments[i]]=arguments[i+1];
    }
  }

  if( b.run_to_breakpoint ) {

    if(b.breakpoints[r]) {
      if( b.step_callback(r,c,vals) ) {
        return new Promise(
                function(res,rej) {
                  b.resolve=res;
                }
            );
      }
    }

  }
  else {
    if( b.step_callback(r,c,vals) ) {
      return new Promise(
              function(res,rej) {
                b.resolve=res;
              }
          );
    }
  }
  return true;
}

Kensakan.prototype.template_no_watch_args = async function(b,r,c) 
{

  var b = Kensakan.prototype.instances[b];

  if( b.run_to_breakpoint ) {

    if(b.breakpoints[r]) {
      if( b.step_callback(r,c) ) {
        return new Promise(
                function(res,rej) {
                  b.resolve=res;
                }
            );
      }
    }

  }
  else {
    if( b.step_callback(r,c) ) {
      return new Promise(
              function(res,rej) {
                b.resolve=res;
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

export default Kensakan;