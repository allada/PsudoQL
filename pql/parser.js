import { COMPARITORS }  from './parser/comparitors.js';
import { AND }          from './opcodes/and.js';
import { CONSTANT }     from './opcodes/constant.js';
import { FIELD }        from './opcodes/field.js';
import { FUNCTION }     from './opcodes/function.js';
import { GROUP }        from './opcodes/group.js';
import { NULL }         from './opcodes/null.js';
import { OR }           from './opcodes/or.js';
import { SEPERATOR }    from './opcodes/seperator.js';
import { SEPERATORS }   from './opcodes/seperators.js';
import { NO_VALUE }     from './opcodes/comparitors/no_value.js';
import { TABLE_REF }    from './parser/table_ref.js';

export class PARSER {
    constructor (query, ref_table, allow_seperator = false, config = null, table_refs = []) {
        this._hasError      = false;
        this._error         = null;
        this._codes         = [];
        this._comparitors   = new COMPARITORS(config.COMPARITORS);
        this._table_refs    = table_refs;

        // Defaults to false
        allow_seperator     = !!allow_seperator;

        if (config !== undefined) {
            this._config = config;
        } else {
            this._config = PARSER.getDefaultConfig();
        }

        this._ref_table = ref_table;

        if (!query.length) {
            let group = new GROUP(this, []);
            group.setNeedWrap(false);
            this.setCodes(group);
        } else {

            try {
                let general = this.T_GENERAL(query, allow_seperator);
                if (general !== false && general[0] != query.length) {
                    throw ["Unknown character", query.length - general[0]];
                }
                if (general[1] instanceof GROUP) {
                    general[1].setNeedWrap(false)
                }
                this.setCodes(general[1]);
            } catch (e) {
                if (e instanceof Array) {
                    this.setError([`${e[0]} at character ${(query.length - e[1]).toString()}`, query.length - e[1]], true);
                }
                this.setError(e.message || e, true);
            }
        }
    }
    getRefTable () {
        return this._ref_table;
    }
    _getCodesOfGroup (need_group) {
        let codes = this._codes;

        if (codes instanceof GROUP) {
            let group_codes = codes.getOpCodes();
            let new_codes = [];
            for (let code of group_codes) {
                // If it has an OR just return all of them if in where
                if (code instanceof OR) {
                    if (need_group) {
                        return codes;
                    } else {
                        return (new GROUP(this, [])).setNeedWrap(false);
                    }
                }
                if (!!need_group == code.needsGroup()) {
                    new_codes.push(code);
                }
            }
            // Trims off any comparitors (ANDs and ORs) from beginning and end of codes
            while (new_codes.length) {
                if (new_codes[0] instanceof SEPERATORS) {
                    new_codes.shift();
                } else {
                    break;
                }
            }
            while (new_codes.length) {
                if (new_codes[new_codes.length - 1] instanceof SEPERATORS) {
                    new_codes.pop();
                } else {
                    break;
                }
            }
            return (new GROUP(this, new_codes)).setNeedWrap(false);
        } else {
            if (need_group != codes.needsGroup()) {
                return (new GROUP(this, [])).setNeedWrap(false);
            } else {
                return codes;
            }
        }
    }

    getWhereCodes () {
        return this._getCodesOfGroup(false);
    }

    getHavingCodes () {
        return this._getCodesOfGroup(true);
    }

    getCodes () {
        return this._codes;
    }
    setCodes (v) {
        this._codes = v;
        return this;
    }

    setError (error, noThrow) {
        this._error = error;
        this._hasError = true;
        if (!noThrow) {
            throw error;
        }
    }
    getError () {
        return this._error;
    }
    hasError () {
        return this._hasError;
    }
    getConfig () {
        return this._config;
    }
    static setDefaultConfig (config) {
        PARSER._config = config;
        return this;
    }
    static getDefaultConfig () {
        return PARSER._config;
    }

    // Checks if any of the comparitor operators persist here
    T_COMPARITOR (str) {
        var start_pos = 0;
        var next_char;
        while ((next_char = str.substr(start_pos, 1)) && (next_char === ' ' || next_char === "\r" || next_char === "\n" || next_char === "\t")) {
            // Ignore spaces
            start_pos++;
        }
        let max_comp_len = this._comparitors.getComparitorMaxLength();

        // 0 because it 0 is not to be counted... 1 is the max
        for (let i = max_comp_len; i > 0; i--) {
            if (this._comparitors.comparitors.has(i)) {
                let chrs = str.substr(start_pos, i);
                let cmps = this._comparitors.comparitors.get(i);
                for (let c of cmps) {
                    if (c[0] === chrs) {
                        return [i + start_pos, new c[1](this)];
                    }
                }
            }
        }
        return false;
    }

    /*
     * When a table reference is specified.
     */
    T_TABLE_REF (str, table_ref) {
        let match = str.match(/^([a-zA-Z0-9_]+)\./);
        if (!match) {
            return false;
        }
        str = str.substring(match[0].length);
        if (!table_ref) {
            let refs = this._table_refs.slice(0);
            refs.push(match[1]);
            table_ref = new TABLE_REF(this, refs[0]);
            // Start at one because first one already done
            for (let i = 1; i < refs.length; i++) {
                table_ref.appendRef(refs[i]);
            }
        } else {
            table_ref.appendRef(match[1]);
        }

        // Will recrusively loop until no more table refs exist
        // Will also modify the table_ref with any additional tables in this
        let sub_ref = this.T_TABLE_REF(str, table_ref);
        if (!sub_ref) {
            let field = this.T_FIELD(str, table_ref);
            if (!field) {
                throw ["Expected T_FIELD", str.length];
            }
            return [
                match[0].length + field[0],
                field[1]
            ];
        }
        return [
            match[0].length + sub_ref[0],
            sub_ref[1]
        ];
    }
    /*
     * Is the value that comes after a comparitor.
     */
    T_COMPARE_VALUE (str) {
        var next_char;
        var tries = 0;
        var next_char;
        // Ignore spaces
        while ((next_char = str.substr(tries, 1)) && (next_char === ' ' || next_char === "\r" || next_char === "\n" || next_char === "\t")) {
            tries++;
        }
        // NULL is unique and is a solid hyphen
        if (next_char == '-' && /^-(?:[^a-zA-Z0-9_]|$)/.test(str.substr(tries))) {
            return [
                tries + 1,
                new NULL()
            ];
        }

        let match;
        let data;
        switch (next_char) {
            case '"':
                match = str.match(/^\s*"((?:[^"\\]?(?:\\[\x00-\xFF])?)*)"/);
                if (!match) {
                    return false;
                }
                match[1] = match[1].replace(/((?:^|[^\\])(\\\.)*)\\n/, "$1\n");
                match[1] = match[1].replace(/((?:^|[^\\])(\\\\)*)\\r/, "$1\r");
                match[1] = match[1].replace(/((?:^|[^\\])(\\\\)*)\\t/, "$1\t");
                data = match[1].replace(/\\([\x00-\xFF])/, '$1');
                break;
            case "'":
                match = str.match(/^\s*'((?:[^'\\]?(?:\\[\x00-\xFF])?)*)'/);
                if (!match) {
                    return false;
                }
                match[1] = match[1].replace(/((?:^|[^\\])(\\\.)*)\\n/, "$1\n");
                match[1] = match[1].replace(/((?:^|[^\\])(\\\\)*)\\r/, "$1\r");
                match[1] = match[1].replace(/((?:^|[^\\])(\\\\)*)\\t/, "$1\t");
                data = match[1].replace(/\\([\x00-\xFF])/, '$1');
                break;
            default:
                match = str.match(/^\s*([a-zA-Z0-9_\-.]+)/);
                if (!match) {
                    return false;
                }
                data = match[1];
                break;
        }
        return [
            match[0].length,
            new CONSTANT(this, data)
        ];
    }

    /*
     * Is a field in a table
     */
    T_FIELD (str, table_ref) {
        let match = str.match(/^[a-zA-Z0-9_]+/);
        if (!match) {
            return false;
        }
        if (!table_ref) {
            if (this._table_refs.length) {
                table_ref = new TABLE_REF(this, this._table_refs[0]);
                // Start at one because first one already done
                for (let i = 1; i < this._table_refs.length; i++) {
                    table_ref.appendRef(this._table_refs[i]);
                }
            }
        }

        let field = new FIELD(this, match[0], table_ref);
        str = str.substring(match[0].length);

        let comparitor = this.T_COMPARITOR(str);
        if (!comparitor) {
            return [
                match[0].length,
                field
            ];
            //throw ["Expected T_COMPARITOR", str.length];
        }
        if (comparitor[1] instanceof NO_VALUE) {
            return [
                match[0].length + comparitor[0],
                field
            ];
        }

        str = str.substring(comparitor[0]);
        let value = this.T_COMPARE_VALUE(str);
        if (!value) {
            throw ["Expected T_COMPARE_VALUE", str.length];
        }
        comparitor[1]
            .setLeft(field)
            .setRight(value[1]);

        return [
            match[0].length + comparitor[0] + value[0],
            comparitor[1]
        ];
    }

    /*
     * Is a function in sql
     */
    T_FUNCTION (str) {
        var match = str.match(/^([a-zA-Z0-9_]+)\(\s*/);
        if (!match) {
            return false;
        }
        let func        = new FUNCTION(this, match[1]);
        let max_args    = func.getMaxArgs();
        let min_args    = func.getMinArgs();
        let sum_length  = 0;
        let found_args  = [];
    
        str = str.substring(match[0].length);
        for (let i = 0; true; i++) {
            if (found_args.length >= max_args) {
                throw ["Function '" + func.getFuncName() + "' cannot have more than " + max_args.toString() + " args", str.length];
            }
            let general = this.T_GENERAL(str);
            if (!general && found_args.length < min_args) {
                throw ["Function '" + func.getFuncName() + "' expected " + min_args.toString() + " but got " + found_args.length.toString() + " args", str.length]; 
            }
            if (!general) {
                break;
            }
            sum_length += general[0];
            if (general instanceof GROUP) {
                general.setNeedWrap(false);
            }
            found_args.push(general[1]);
            str = str.substring(general[0]);
    
            let seperator = this.T_SEPERATOR(str);
            if (!seperator) {
                break;
            }
            str = str.substring(seperator[0]);
            sum_length += seperator[0];
        }
        let closer = this.T_GROUP_CLOSER(str);
        if (!closer) {
            throw ["Open function group tag without close tag", str.length];
        }
        func.setArgs(found_args);
        str = str.substring(closer[0]);
    
        let comparitor = this.T_COMPARITOR(str);
        if (!comparitor) {
            return [
                match[0].length + sum_length + closer[0],
                func
            ];
            //throw ["Expected T_COMPARITOR", str.length];
        }
        if (comparitor[1] instanceof NO_VALUE) {
            return [
                match[0].length + sum_length + closer[0] + comparitor[0],
                func
            ];
        }
        str = str.substring(comparitor[0]);
        let value = this.T_COMPARE_VALUE(str);
        if (!value) {
            throw ["Expected T_COMPARE_VALUE", str.length];
        }
        comparitor[1].setLeft(func);
        comparitor[1].setRight(value[1]);
    
        return [
            match[0].length + sum_length + closer[0] + comparitor[0] + value[0],
            comparitor[1]
        ];
    }

    /*
     * Is a null literal. "-" character.
     */
    T_NULL (str) {
        if (str.substr(0, 1) == '-') {
            return [1, new NULL(this)];
        }
        return false;
    }

    /*
     * Is a string constant. The matching string will be exactly sent as is. Also good for binary data.
     */
    T_CONSTANT (str) {
        let chr = str.substr(0, 1);
        let match;
        switch (chr) {
            case '"':
                match = str.match(/^"((?:[^"\\]?(?:\\[\x00-\xFF])?)*)"/);
                // Make sure we have data
                if (match && match.length && match[1].length) {
                    match[1] = match[1].replace(/((?:^|[^\\])(\\\.)*)\\n/, "$1\n");
                    match[1] = match[1].replace(/((?:^|[^\\])(\\\\)*)\\r/, "$1\r");
                    match[1] = match[1].replace(/((?:^|[^\\])(\\\\)*)\\t/, "$1\t");
                    match[1] = match[1].replace(/\\([\x00-\xFF])/, '$1');
                }
                break;
            case "'":
                match = str.match(/^'((?:[^'\\]?(?:\\[\x00-\xFF])?)*)'/);
                // Make sure we have data
                if (match && match.length && match[1].length) {
                    match[1] = match[1].replace(/((?:^|[^\\])(\\\.)*)\\n/, "$1\n");
                    match[1] = match[1].replace(/((?:^|[^\\])(\\\\)*)\\r/, "$1\r");
                    match[1] = match[1].replace(/((?:^|[^\\])(\\\\)*)\\t/, "$1\t");
                    match[1] = match[1].replace(/\\([\x00-\xFF])/, '$1');
                }
                break;
            case '-':
                return [1, new NULL(this)];
        }
        if (!match) {
            return false;
        }
        return [
            match[0].length,
            new CONSTANT(this, match[1])
        ];
    }
    T_GENERAL (str, allow_seperator) {
        let op_order = [
            this.T_TABLE_REF,
            this.T_FUNCTION,
            this.T_FIELD,
            this.T_GROUP_OPENER,
            this.T_CONSTANT,
            /*this.T_SUBQUERY_OPENER*/
        ];
        let op_len = op_order.length;
        let used_str_len = 0;
        let op_codes = [];
        let found;

        do {
            for (let i = 0; i < op_len; i++) {
                found = op_order[i].call(this, str);
                if(found){
                    break;
                }
            }
            if (found) {
                let sep;
                str = str.substring(found[0]);
                used_str_len += found[0];
                if (op_codes.length && !(op_codes[op_codes.length - 1] instanceof SEPERATORS)) {
                    throw [`Expected space, "|"${ (allow_seperator) ? ' or ","': '' }`, str.length + found[0]];
                }
                op_codes.push(found[1]);

                // This is a simple trick to keep from many ifs from being needed.
                switch (allow_seperator) {
                    case true:
                        if ((sep = this.T_SEPERATOR(str))) {
                            break;
                        }
                    default:
                        if ((sep = this.T_OR(str)) || (sep = this.T_AND(str))) {
                            break;
                        }
                }
                if (sep) {
                    str = str.substring(sep[0]);
                    used_str_len += sep[0];
                    op_codes.push(sep[1]);
                }
            }
        } while (found && str.length != 0);

        // Removes any trailing ANDs
        while (op_codes.length) {
            if (op_codes[op_codes.length - 1] instanceof AND) {
                op_codes.pop();
            } else {
                break;
            }
        }

        if (op_codes.length && op_codes[op_codes.length - 1] instanceof SEPERATORS) {
            throw ["Cannot terminate this section with a seperator", str.length];
        }
    
        if (op_codes.length && op_codes.length > 1) {
            return [
                used_str_len,
                new GROUP(this, op_codes)
            ];
        } else if(op_codes.length == 1) {
            return [
                used_str_len,
                op_codes[0]
            ];
        }
        return false;
    }

    /*
     * Represents an open prenthesis "("
     */
    T_GROUP_OPENER (str) {
        let match = str.match(/^\s*\(\s*/);
        if (!match) {
            return false;
        }
        str = str.substring(match[0].length);
        let general = this.T_GENERAL(str);
        if (!general) {
            throw ["Group cannot be empty", str.length];
        }
        str = str.substring(general[0]);
        let closer = this.T_GROUP_CLOSER(str);
        if (!closer) {
            throw ["Open group tag without close tag", str.length];
        }
        return [
            match[0].length + general[0] + closer[0],
            general[1]
        ];
    }

    /*
     * Represents a closed prenthesis ")"
     */
    T_GROUP_CLOSER (str) {
        let match = str.match(/^\s*\)/);
        if (!match) {
            return false;
        }
        return [
            match[0].length,
            true
        ];
    }

    /*
     * Represents an open prenthesis "{". The data inside will be parsed as a subquery.
     */
    T_SUBQUERY_OPENER (str) {
        // TODO: this
    }

    /*
     * Represents a closed prenthesis "}"
     */
    T_SUBQUERY_CLOSER (str) {
        // TODO: this
    }

    /*
     * Is the space character
     */
    T_AND (str){
        let match = str.match(/^\s+/);
        if (!match) {
            return false;
        }
        return [
            match[0].length,
            new AND(this)
        ];
    }

    /*
     * Is the pipe "|" character
     */
    T_OR (str) {
        let match = str.match(/^\s*\|\s*/);
        if (!match) {
            return false;
        }
        return [
            match[0].length,
            new OR(this)
        ];
    }

    /*
     * Is the comma "," character
     */
    T_SEPERATOR (str) {
        let match = str.match(/^\s*,\s*/);
        if (!match) {
            return false;
        }
        return [
            match[0].length,
            new SEPERATOR(this)
        ];
    }
}
