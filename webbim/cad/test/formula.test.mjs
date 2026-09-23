// What a person may type into a number.
//
// A box that only accepts 4.5 makes you do the arithmetic on paper and type
// the answer in, and a model built that way is full of numbers nobody can
// explain. So the box takes quantities, arithmetic and the names of other
// things - and every one of those is a place to be wrong, which is why all of
// it is checked here against numbers that can be written down first.
//
// Ten metres in a millimetre field is ten thousand. Half a turn is a hundred
// and eighty degrees. A quarter of pi radians is forty-five degrees. None of
// those are opinions.
import { CONSTANTS, UNITS, convert, evaluate, fieldUnit, jsOf, namesIn, parse,
         readValue, saysFormula, tokenise, unitNamed } from "../src/formula.js";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
};
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const lookup = name => ({ Width: 2400, Bays: 3, Height: 900 })[name];
const known = name => lookup(name) !== undefined;
const mm = text => readValue(text, { unit: "mm", lookup, known });
const deg = text => readValue(text, { unit: "°", lookup, known });

console.log("1. the units, and the one thing a unit table has to get right");
{
  check("a metre is a thousand millimetres", unitNamed("m").is === 1000);
  check("an inch is 25.4 of them", unitNamed("in").is === 25.4);
  check("a foot is twelve inches", near(unitNamed("ft").is, 12 * 25.4, 1e-9));
  check("a mile is 5280 feet", near(unitNamed("mi").is, 5280 * 304.8, 1e-6));
  check("a radian is 180 over pi degrees", near(unitNamed("rad").is, 180 / Math.PI));
  check("a turn is 360", unitNamed("turn").is === 360);
  check("a gon is nine tenths of a degree", near(unitNamed("grad").is, 0.9));
  check("the long names work too", unitNamed("metres") === unitNamed("m")
        && unitNamed("degrees") === unitNamed("deg"));
  check("and the sign does", unitNamed("°") === unitNamed("deg"));
  check("a field says which one it is in", fieldUnit("mm") === unitNamed("mm"));
  check("and a field with no unit is a plain number", fieldUnit("") === null);
  // The one rule that stops a wall being 90 millimetres long.
  check("an angle cannot be put into a length",
        convert(unitNamed("deg"), unitNamed("mm")) === null);
  check("nor a length into an angle",
        convert(unitNamed("m"), unitNamed("deg")) === null);
  check("and a bare number takes whatever the field is in",
        convert(null, unitNamed("mm")) === 1);
}

console.log("\n2. reading what was typed");
{
  check("a number is a number", mm("250").kind === "number" && mm("250").value === 250);
  check("ten metres in a millimetre field is ten thousand",
        near(mm("10m").value, 10000), JSON.stringify(mm("10m")));
  check("and so is 10 metres with a space", near(mm("10 m").value, 10000));
  check("and 10 metres spelled out", near(mm("10 metres").value, 10000));
  check("a foot is 304.8", near(mm("1ft").value, 304.8));
  check("six feet three inches, added up", near(mm("6ft + 3in").value, 6 * 304.8 + 3 * 25.4));
  check("half a turn is 180 degrees", near(deg("0.5turn").value, 180));
  check("a quarter of pi radians is 45", near(deg("pi/4 rad").value, 45, 1e-9));
  check("and 45 degrees typed into a degree field is 45", near(deg("45°").value, 45));
}

console.log("\n3. the arithmetic");
{
  check("2400 over 3 is 800", near(mm("2400/3").value, 800));
  check("10 x 10 is a hundred - x is how people write times",
        near(mm("10 x 10").value, 100), JSON.stringify(mm("10 x 10")));
  check("and the sign is too", near(mm("10 × 10").value, 100));
  check("brackets bind before the multiply", near(mm("2 * (3 + 4)").value, 14));
  check("and the multiply binds before the plus", near(mm("2 * 3 + 4").value, 10));
  check("powers go right to left, as powers do", near(mm("2^3^2").value, 512));
  check("a minus in front is a minus", near(mm("-40").value, -40));
  check("two pi hundred: a thing after a thing is a product",
        near(mm("2 pi 100").value, 200 * Math.PI, 1e-9));
  check("sqrt(2) metres is 1414.2 millimetres",
        near(mm("sqrt(2) m").value, Math.SQRT2 * 1000, 1e-9), JSON.stringify(mm("sqrt(2) m")));
  check("the trigonometry is in degrees, which is what a field is in",
        near(mm("100 * sin(30)").value, 50, 1e-9));
  check("and pi is pi", near(CONSTANTS.pi, Math.PI));
  check("dividing by nothing is said, not silently infinite",
        mm("10/0").kind === "error" && /divides by nothing/.test(mm("10/0").message),
        JSON.stringify(mm("10/0")));
}

console.log("\n4. nothing is ever run, only worked out");
{
  // The whole reason for a parser rather than eval. If this ever passes
  // through to the engine, a number box becomes a way to run code, and a
  // model file becomes a way to send it.
  const nasty = mm("globalThis.fetch");
  check("a property lookup is not a value", nasty.kind === "error", JSON.stringify(nasty));
  check("nor is a call to something that is not arithmetic",
        mm("alert(1)").kind === "error", JSON.stringify(mm("alert(1)")));
  check("nor a string", mm("'x'").kind === "error");
  check("and an empty box is blank rather than nought", mm("").kind === "blank");
}

console.log("\n5. names, wires and formulas");
{
  check("one name on its own is a wire, not a formula",
        mm("Width").kind === "wire" && mm("Width").name === "Width",
        JSON.stringify(mm("Width")));
  const one = mm("Width/Bays");
  check("two names make a formula", one.kind === "formula", JSON.stringify(one));
  check("which knows what it is about", one.names.join() === "Width,Bays");
  check("and what it comes to, right now", near(one.value, 800));
  check("and carries the formula written over a, b and c", one.js === "(a / b)", one.js);
  const two = mm("Width * 2 + 100mm");
  check("a name and a quantity together work",
        two.kind === "formula" && near(two.value, 4900), JSON.stringify(two));
  check("with the unit already folded into the formula",
        two.js === "((a * 2) + 100)", two.js);
  // A metre inside a formula has to be converted where the formula is
  // written, not where it is read - the node it becomes has no idea what
  // field it came from.
  const three = mm("Width + 1m");
  check("a metre inside a formula is folded in as a thousand",
        three.js === "(a + 1000)", three.js);
  check("and it comes to the right number", near(three.value, 3400));
  check("a name nothing is called says so",
        mm("Nope + 1").kind === "error" && /called Nope/.test(mm("Nope + 1").message),
        JSON.stringify(mm("Nope + 1")));
  check("and more than three things is refused with a reason",
        /at most three/.test(mm("Width + Bays + Height + Width2").message || "")
        || /called/.test(mm("Width + Bays + Height + Width2").message || ""),
        JSON.stringify(mm("Width + Bays + Height + Width2")));
}

console.log("\n6. the pieces on their own");
{
  check("the tokeniser keeps a unit with its number",
        tokenise("10mm")[0].unit === unitNamed("mm"));
  check("and tells 10 from 10mm", tokenise("10")[0].unit === null);
  check("names come out in the order they appear",
        namesIn(parse("Bays + Width + Bays")).join() === "Bays,Width");
  check("and a constant is not a name", namesIn(parse("pi * Width")).join() === "Width");
  check("evaluate takes a field and a lookup",
        near(evaluate(parse("Width / Bays"), { into: unitNamed("mm"), lookup }), 800));
  check("and jsOf writes it over the letters in order",
        jsOf(parse("Bays * Width"), ["Bays", "Width"], unitNamed("mm")) === "(a * b)");
  check("a formula names itself for the tree",
        saysFormula("  Width  /  Bays ") === "Width / Bays",
        saysFormula("  Width  /  Bays "));
  check("every unit in the table has a key and a kind",
        UNITS.every(u => u.key && (u.of === "length" || u.of === "angle") && u.is > 0));
}

console.log("\n7. what is typed badly is said badly, in words");
{
  for (const [said, why] of [["10 +", "stops in the middle"], ["(1 + 2", "not closed"],
                             ["m", "unit, not a value"], ["10mm", null]]) {
    const got = mm(said);
    if (!why) { check(JSON.stringify(said) + " is fine", got.kind === "number"); continue; }
    check(JSON.stringify(said) + " says " + JSON.stringify(why),
          got.kind === "error" && got.message.includes(why),
          JSON.stringify(got));
  }
  check("a degree typed into a count is refused",
        readValue("45deg", { unit: "" }).kind === "error",
        JSON.stringify(readValue("45deg", { unit: "" })));
  check("and a plain number in a count is fine",
        readValue("45", { unit: "" }).value === 45);
}

console.log(failures ? "\n" + failures + " failed" : "\nall checks passed");
process.exit(failures ? 1 : 0);
