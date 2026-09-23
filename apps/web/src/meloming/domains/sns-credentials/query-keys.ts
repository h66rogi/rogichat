/**
 * SNS Credentials TanStack Query keys.
 */
export const snsCredentialsQueryKey = ["sns-credentials"] as const;

export const snsCredentialsKeys = {
  all: snsCredentialsQueryKey,
  list: () => [...snsCredentialsQueryKey, "list"] as const,
};
