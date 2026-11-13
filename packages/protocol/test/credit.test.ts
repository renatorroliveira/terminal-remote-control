import { describe, expect, it } from 'vitest';
import { accrueCredit, CREDIT_STEP, CREDIT_WINDOW } from '../src/credit';

describe('accrueCredit', () => {
    it('uses a 1 MiB window returned in 64 KiB steps (S3b, TECH_STACK §6)', () => {
        expect([CREDIT_WINDOW, CREDIT_STEP]).toEqual([1_048_576, 65_536]);
    });

    it('holds credit until a whole step has been rendered', () => {
        expect(accrueCredit(0, 40_000)).toEqual({ pending: 40_000, grant: 0 });
        expect(accrueCredit(40_000, 30_000)).toEqual({ pending: 0, grant: 70_000 });
    });

    it('grants everything pending once a step is reached, however large', () => {
        expect(accrueCredit(10, 200_000)).toEqual({ pending: 0, grant: 200_010 });
    });
});
