"use strict";
/* Copyright (c) 2022-2026 Richard Rodger and other contributors, MIT License */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const parser_1 = require("@tabnas/parser");
const path_1 = require("../dist/path");
// A small, deliberately-minimal grammar: brace maps with bare (unquoted)
// keys, bracket lists, and scalar values — just enough nested structure to
// exercise the Path plugin. The Tabnas engine ships no grammar of its own,
// so tests bring their own; this fixture depends on nothing but the Tabnas
// parser itself. The rule names (val/map/pair/list/elem) are the ones the
// Path plugin hooks.
const Grammar = (tn) => {
    const { TX, ST } = tn.token;
    tn.grammar({
        ref: {
            '@pairkey': (r) => {
                const kt = r.o0;
                r.u.key = ST === kt.tin || TX === kt.tin ? kt.val : kt.src;
            },
            '@val-bo': (r) => (r.node = undefined),
            '@val-bc': (r, ctx) => {
                r.node =
                    undefined === r.node
                        ? undefined === r.child.node
                            ? 0 === r.os
                                ? undefined
                                : r.o0.resolveVal(r, ctx)
                            : r.child.node
                        : r.node;
            },
            '@map-bo': (r) => (r.node = {}),
            '@list-bo': (r) => (r.node = []),
            '@pair-bc': (r) => {
                if (r.u.pair)
                    r.node[r.u.key] = r.child.node;
            },
            '@elem-bc': (r) => {
                if (undefined !== r.child.node)
                    r.node.push(r.child.node);
            },
        },
        rule: {
            val: {
                open: [{ s: '#OB', p: 'map', b: 1 }, { s: '#OS', p: 'list', b: 1 }, { s: '#VAL' }],
                close: [{ s: '#ZZ' }, { b: 1 }],
            },
            map: {
                open: [{ s: '#OB #CB', b: 1 }, { s: '#OB', p: 'pair' }],
                close: [{ s: '#CB' }],
            },
            list: {
                open: [{ s: '#OS #CS', b: 1 }, { s: '#OS', p: 'elem' }],
                close: [{ s: '#CS' }],
            },
            pair: {
                open: [{ s: '#KEY #CL', p: 'val', u: { pair: true }, a: '@pairkey' }],
                close: [{ s: '#CA', r: 'pair' }, { s: '#CB', b: 1 }],
            },
            elem: {
                open: [{ p: 'val' }],
                close: [{ s: '#CA', r: 'elem' }, { s: '#CS', b: 1 }],
            },
        },
    });
};
// Build a parser with the local grammar and the Path plugin. The grammar
// is installed first so the plugin's @<rule>-<phase> refs wire onto the
// existing rules.
const make = () => new parser_1.Tabnas().use(Grammar).use(path_1.Path);
// Annotate nodes with their tracked path: maps get a `$` property, scalars
// become `<value:path>`, arrays are left as-is (their elements are
// annotated individually).
const capture = (tn) => {
    tn.rule('val', (rs) => rs.ac(false, (r) => {
        if (null === r.node || 'object' !== typeof r.node) {
            // String coercion reads path immediately — safe.
            r.node = `<${r.node}:${r.k.path}>`;
        }
        else if (!Array.isArray(r.node)) {
            r.node.$ = `<${r.k.path}>`;
        }
    }));
};
(0, node_test_1.describe)('path', () => {
    (0, node_test_1.test)('happy', () => {
        const j = make();
        node_assert_1.default.deepEqual(j.parse('{a:{b:1,c:[2,3]}}'), { a: { b: 1, c: [2, 3] } });
    });
    (0, node_test_1.test)('path-tracking', () => {
        const j = make().use(capture);
        const out = j.parse('{a:{b:1}}');
        node_assert_1.default.equal(out.$, '<>');
        node_assert_1.default.equal(out.a.$, '<a>');
        node_assert_1.default.equal(out.a.b, '<1:a,b>');
    });
    (0, node_test_1.test)('meta', () => {
        const j = make().use((tn) => {
            tn.rule('val', (rs) => rs.ac(false, (r) => {
                if (null !== r.node && 'object' === typeof r.node && !Array.isArray(r.node)) {
                    r.node.$ = `<${r.k.path}>`;
                }
            }));
        });
        node_assert_1.default.deepEqual(j.parse('{a:1}', { path: { base: ['x', 'y'] } }), {
            $: '<x,y>',
            a: 1,
        });
    });
    (0, node_test_1.test)('object', () => {
        const j = make().use(capture);
        node_assert_1.default.deepEqual(j.parse('{a:1}'), { $: '<>', a: '<1:a>' });
        node_assert_1.default.deepEqual(j.parse('{a:1,b:B}'), { $: '<>', a: '<1:a>', b: '<B:b>' });
        node_assert_1.default.deepEqual(j.parse('{x:{a:1}}'), { $: '<>', x: { $: '<x>', a: '<1:x,a>' } });
        node_assert_1.default.deepEqual(j.parse('{y:{x:{a:1,b:B}}}'), { $: '<>', y: { $: '<y>', x: { $: '<y,x>', a: '<1:y,x,a>', b: '<B:y,x,b>' } } });
    });
    (0, node_test_1.test)('array', () => {
        const j = make().use(capture);
        node_assert_1.default.deepEqual(j.parse('[1]'), ['<1:0>']);
        node_assert_1.default.deepEqual(j.parse('[1,2,3]'), ['<1:0>', '<2:1>', '<3:2>']);
        node_assert_1.default.deepEqual(j.parse('[[1,2]]'), [['<1:0,0>', '<2:0,1>']]);
        node_assert_1.default.deepEqual(j.parse('[[[1,2,3]]]'), [[['<1:0,0,0>', '<2:0,0,1>', '<3:0,0,2>']]]);
    });
    (0, node_test_1.test)('deep-mixed', () => {
        const j = make().use(capture);
        node_assert_1.default.deepEqual(j.parse('{a:{b:1,c:{d:{e:2}}},f:4}'), {
            $: '<>',
            a: {
                $: '<a>',
                b: '<1:a,b>',
                c: { $: '<a,c>', d: { $: '<a,c,d>', e: '<2:a,c,d,e>' } },
            },
            f: '<4:f>',
        });
        node_assert_1.default.deepEqual(j.parse('[a,[b],{c:1,d:[2,3]}]'), [
            '<a:0>',
            ['<b:1,0>'],
            { $: '<2>', c: '<1:2,c>', d: ['<2:2,d,0>', '<3:2,d,1>'] },
        ]);
    });
    (0, node_test_1.test)('path-is-mutable', () => {
        // Verify that r.k.path is a shared mutable array (pooled per depth).
        // Client code that needs to retain it must copy.
        const captured = [];
        const j = make().use((tn) => {
            tn.rule('val', (rs) => rs.ac(false, (r) => {
                if (null === r.node || 'object' !== typeof r.node) {
                    captured.push({
                        live: r.k.path,
                        snapshot: r.k.path.slice(),
                        value: r.node,
                    });
                }
            }));
        });
        j.parse('{a:1,b:2,c:{d:3}}');
        const snaps = captured.map((c) => ({ v: c.value, p: c.snapshot }));
        node_assert_1.default.deepEqual(snaps, [
            { v: 1, p: ['a'] },
            { v: 2, p: ['b'] },
            { v: 3, p: ['c', 'd'] },
        ]);
        // a and b are both depth 1, so their live path arrays are the same
        // pooled instance.
        node_assert_1.default.strictEqual(captured[0].live, captured[1].live);
    });
});
//# sourceMappingURL=path.test.js.map