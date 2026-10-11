"""Deterministic retirement model. All amounts are 万元 at 2026 purchasing power.

Run: python3 retirement-model.py
Export: python3 retirement-model.py --csv /tmp/retirement-cashflows.csv
No pension entitlement or probability of investment success is estimated.
"""

import argparse
import csv
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class Plan:
    start_age: int = 40
    wife_age_at_start: int = 39
    own_pension_age: int = 63
    wife_pension_age: int = 58
    own_end_age: int = 85
    wife_end_age: int = 85
    spending: float = 30
    wife_salary: float = 20
    self_paid_social_insurance: float = 3
    own_pension: float = 6
    wife_pension: float = 10


def annual_cashflows(plan):
    years = max(plan.own_end_age - plan.start_age,
                plan.wife_end_age - plan.wife_age_at_start)
    for year in range(years):
        own_age = plan.start_age + year
        wife_age = plan.wife_age_at_start + year
        insurance = (plan.self_paid_social_insurance
                     if own_age < plan.own_pension_age else 0)
        salary = (plan.wife_salary
                  if wife_age < min(plan.wife_pension_age, plan.wife_end_age) else 0)
        own_pension = (plan.own_pension
                       if plan.own_pension_age <= own_age < plan.own_end_age else 0)
        wife_pension = (plan.wife_pension
                        if plan.wife_pension_age <= wife_age < plan.wife_end_age else 0)
        yield {
            'year_index': year, 'own_age': own_age, 'wife_age': wife_age,
            'spending': plan.spending, 'self_paid_insurance': insurance,
            'wife_salary': salary, 'own_pension': own_pension,
            'wife_pension': wife_pension,
            'net_draw': plan.spending + insurance - salary - own_pension - wife_pension,
        }


def present_value(plan, real_return):
    return sum(row['net_draw'] / (1 + real_return) ** row['year_index']
               for row in annual_cashflows(plan))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', help='Optional annual cashflow output file')
    args = parser.parse_args()
    baseline = Plan()
    scenarios = {
        'lower_income': replace(baseline, wife_salary=15, own_pension=4,
                                wife_pension=6, self_paid_social_insurance=4),
        'baseline': baseline,
        'higher_income': replace(baseline, wife_salary=25, own_pension=8,
                                 wife_pension=12, self_paid_social_insurance=2),
        'insurance_in_spending': replace(baseline, self_paid_social_insurance=0),
        'wife_retires_at_55': replace(baseline, wife_pension_age=55),
        'both_to_95': replace(baseline, own_end_age=95, wife_end_age=95),
        'no_pension_offset': replace(baseline, own_pension=0, wife_pension=0),
        'spending_35': replace(baseline, spending=35),
    }
    rates = (-0.01, 0, 0.01, 0.02, 0.03)
    print('Scenario; real returns -1%, 0%, 1%, 2%, 3%; amounts in 万元')
    for name, plan in scenarios.items():
        print(name, ', '.join(f'{present_value(plan, rate):.2f}' for rate in rates))
    print('Baseline budget: PV * 1.2 + 100 万元')
    for rate in rates:
        print(f'{rate:.0%}: {present_value(baseline, rate) * 1.2 + 100:.2f}')
    if args.csv:
        rows = list(annual_cashflows(baseline))
        with open(args.csv, 'w', newline='', encoding='utf-8-sig') as output:
            writer = csv.DictWriter(output, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        print(f'Annual baseline cashflows written to {args.csv}')


if __name__ == '__main__':
    main()
