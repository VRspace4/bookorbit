import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import {
  COMMUNITY_RATING_PROVIDER_KEYS,
  FIELD_OPERATORS,
  RULE_FIELDS,
  RULE_OPERATORS,
  type CommunityRatingProvider,
  type GroupRule,
  type Rule,
} from '@bookorbit/types';

const COMMUNITY_RATING_PROVIDER_VALUES = ['any', ...COMMUNITY_RATING_PROVIDER_KEYS] as const;

const ruleSchema: z.ZodType<Rule> = z
  .object({
    type: z.literal('rule'),
    field: z.enum(RULE_FIELDS as unknown as [string, ...string[]]),
    operator: z.enum(RULE_OPERATORS as unknown as [string, ...string[]]),
    value: z.union([z.string(), z.number(), z.array(z.string().min(1)).min(1).max(20), z.array(z.number()).min(1).max(20)]).optional(),
    valueTo: z.union([z.string(), z.number()]).optional(),
    provider: z.enum(COMMUNITY_RATING_PROVIDER_VALUES as unknown as [CommunityRatingProvider, ...CommunityRatingProvider[]]).optional(),
  })
  .superRefine((rule, ctx) => {
    if (!FIELD_OPERATORS[rule.field as keyof typeof FIELD_OPERATORS]?.includes(rule.operator as never)) {
      ctx.addIssue({ code: 'custom', message: 'Operator is not valid for this field', path: ['operator'] });
    }
    if (rule.provider !== undefined && rule.field !== 'communityRating') {
      ctx.addIssue({ code: 'custom', message: 'Provider is only valid for community rating rules', path: ['provider'] });
    }
  }) as z.ZodType<Rule>;

const groupRuleSchema = (maxDepth: number): z.ZodType<GroupRule> =>
  z.object({
    type: z.literal('group'),
    join: z.enum(['AND', 'OR']),
    rules: z.array(maxDepth <= 1 ? ruleSchema : z.union([ruleSchema, z.lazy(() => groupRuleSchema(maxDepth - 1))])).min(1),
  }) as z.ZodType<GroupRule>;

export { groupRuleSchema };

export function validateGroupRule(value: unknown): GroupRule | null {
  if (value === null || value === undefined) return null;
  const result = groupRuleSchema(5).safeParse(value);
  if (!result.success) throw new BadRequestException({ message: 'Invalid filter', errors: result.error.flatten() });
  return result.data;
}
