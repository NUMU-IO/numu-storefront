/**
 * Back-compat re-export — the implementation now serves both manual
 * rails (InstaPay and Vodafone Cash) from
 * `./ManualTransferInstructions`. Same component, one code path.
 */
export {
  ManualTransferInstructions,
  ManualTransferInstructions as InstaPayInstructions,
  type ManualTransferPayload,
  type InstaPayPayload,
} from "./ManualTransferInstructions";
