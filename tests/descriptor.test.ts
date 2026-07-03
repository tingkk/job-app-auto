import { describe, expect, it } from 'vitest';
import { collectFieldDescriptors } from '../src/lib/autofill/descriptor';

describe('descriptor extraction', () => {
  it('extracts label, autocomplete, options, and bilingual question text', () => {
    document.body.innerHTML = `
      <form>
        <label for="first">First name</label>
        <input id="first" name="first_name" autocomplete="given-name" />
        <label for="country">国家</label>
        <select id="country" name="country">
          <option value="US">United States</option>
          <option value="CN">China</option>
        </select>
      </form>
    `;
    for (const element of Array.from(document.querySelectorAll('input,select'))) {
      element.getBoundingClientRect = () => ({ width: 100, height: 20 }) as DOMRect;
    }

    const fields = collectFieldDescriptors();

    expect(fields).toHaveLength(2);
    expect(fields[0]?.label).toBe('First name');
    expect(fields[0]?.autocomplete).toBe('given-name');
    expect(fields[1]?.language).toBe('zh-Hans');
    expect(fields[1]?.options.map((option) => option.value)).toEqual(['US', 'CN']);
  });

  it('does not use full-form text as nearby text and ignores submit buttons', () => {
    document.body.innerHTML = `
      <form>
        <div>
          <label for="first">First Name</label>
          <input id="first" name="FirstName" />
        </div>
        <section>
          <h2>Compensation</h2>
          <div>
            <label for="allowance">Guaranteed Allowance Amount 1</label>
            <input id="allowance" name="Guaranteed_Allowance_Amt_1" />
          </div>
        </section>
        <input id="saveContinue" type="submit" value="Save and continue" />
      </form>
    `;
    for (const element of Array.from(document.querySelectorAll('input'))) {
      element.getBoundingClientRect = () => ({ width: 100, height: 20 }) as DOMRect;
    }

    const fields = collectFieldDescriptors();
    const allowance = fields.find((item) => item.idAttribute === 'allowance');

    expect(fields.map((item) => item.idAttribute)).not.toContain('saveContinue');
    expect(allowance?.questionText).toContain('guaranteed allowance amount 1');
    expect(allowance?.questionText).not.toContain('first name');
  });
});
