
'use server';

/**
 * @fileOverview An AI agent for assessing the risk of a loan request.
 *
 * - assessLoanRisk - A function that handles the loan risk assessment process.
 * - AssessLoanRiskInput - The input type for the assessLoanRisk function.
 * - AssessLoanRiskOutput - The return type for the assessLoanRisk function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AssessLoanRiskInputSchema = z.object({
  applicantDetails: z
    .string()
    .optional()
    .describe('Details about the loan applicant including credit score, income, employment history, and any other information relevant to assessing their creditworthiness.'),
  loanDetails: z
    .string()
    .optional()
    .describe('Details about the loan request including loan amount, purpose, and duration.'),
  platformUsageData: z
    .string()
    .optional()
    .describe('Data about the applicants usage of the platform, like transaction history or previous loans.'),
  publicData: z
    .string()
    .optional()
    .describe('Aggregated, anonymized public data that may be relevant to assessing risk.'),
  idFrontDataUri: z
    .string()
    .describe("The front of the user's ID card, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
  idBackDataUri: z
    .string()
    .describe("The back of the user's ID card, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
  workCertificateDataUri: z
    .string()
    .describe("The user's work certificate, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
  bankCertificateDataUri: z
    .string()
    .describe("The user's bank certificate, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
  signatureDataUri: z
    .string()
    .describe("The user's signature, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."),
});
export type AssessLoanRiskInput = z.infer<typeof AssessLoanRiskInputSchema>;

const ExtractedDataSchema = z.object({
  firstName: z.string().describe('First name(s) (nombres) of the applicant.'),
  lastName: z.string().describe('Last name(s) (apellidos) of the applicant.'),
  idNumber: z.string().describe('ID number (cédula) of the applicant.'),
  idIssuePlace: z.string().describe('Place of issue of the ID (Lugar de expedición).'),
  dateOfBirth: z.string().describe('Date of birth of the applicant (YYYY-MM-DD).'),
  phoneNumber: z.string().optional().describe('Phone number of the applicant.'),
  employerName: z.string().describe('Name of the employer.'),
  position: z.string().describe('Job position of the applicant.'),
  salary: z.number().describe('Monthly salary of the applicant.'),
  startDate: z.string().describe('Start date at the current job (YYYY-MM-DD).'),
  bankName: z.string().describe('Name of the bank.'),
  accountHolder: z.string().describe('Account holder name.'),
  accountType: z.string().describe('Type of bank account (e.g., Ahorros, Corriente).'),
  accountNumber: z.string().describe('Bank account number (Número de cuenta).'),
  nameMismatch: z.boolean().describe('True if the names on the documents do not match.'),
});

const AssessLoanRiskOutputSchema = z.object({
  riskScore: z.number().describe('A numerical risk score between 0 and 100, with 0 being the lowest risk and 100 being the highest risk.'),
  riskFactors: z
    .string()
    .describe('A bullet-point summary of the key factors contributing to the risk score, both positive and negative, based on all provided data including documents. The summary must be in Spanish.'),
  extractedData: ExtractedDataSchema.describe('A structured summary of the key information extracted from the provided documents (ID, work and bank certificates).'),
  recommendedAction: z
    .string()
    .describe('A recommended action based on the risk assessment, such as "approve", "deny", or "request more information". The recommendation must be in Spanish.'),
});
export type AssessLoanRiskOutput = z.infer<typeof AssessLoanRiskOutputSchema>;

export async function assessLoanRisk(input: AssessLoanRiskInput): Promise<AssessLoanRiskOutput> {
  return assessLoanRiskFlow(input);
}

const prompt = ai.definePrompt({
  name: 'assessLoanRiskPrompt',
  input: {schema: AssessLoanRiskInputSchema},
  output: {schema: AssessLoanRiskOutputSchema},
  prompt: `You are an AI data extraction tool for a Colombian P2P lending platform. You will be provided with images of the applicant's ID (Cédula de Ciudadanía), work certificate (Certificado Laboral), and bank certificate (Certificación Bancaria).
Your entire analysis and all output fields must be in Spanish.

Your primary task is to extract relevant information from the provided documents and populate the 'extractedData' object.

{{#if loanDetails}}Loan Details: {{{loanDetails}}}{{/if}}

ID Front: {{media url=idFrontDataUri}}
ID Back: {{media url=idBackDataUri}}
Work Certificate: {{media url=workCertificateDataUri}}
Bank Certificate: {{media url=bankCertificateDataUri}}
Signature: {{media url=signatureDataUri}}

1.  **Extract Data (extractedData field):**
    *   **From the ID:**
        *   Get the first name(s) ('firstName', in Spanish: Nombres).
        *   Get the last name(s) ('lastName', in Spanish: Apellidos).
        *   Get the ID number ('idNumber').
        *   Get the date of birth ('dateOfBirth') in YYYY-MM-DD format.
        *   Get the place of issue ('idIssuePlace', in Spanish: Lugar de Expedición).
        *   If a phone number is visible on any document, extract it to 'phoneNumber'.
    *   **From the Work Certificate:**
        *   Get the employer name ('employerName').
        *   Get the position ('position').
        *   Get the salary ('salary') as a number.
        *   Get the start date ('startDate') in YYYY-MM-DD format.
    *   **From the Bank Certificate:**
        *   Get the bank name ('bankName').
        *   Get the account holder name ('accountHolder').
        *   Get the account type ('accountType'), e.g., 'Cuenta de Ahorros', 'Cuenta Corriente'.
        *   Get the account number ('accountNumber').
    *   **Verification:**
        *   Verify that the full name (nombres y apellidos) on all documents matches. If there is a mismatch, set the 'nameMismatch' field to true. Otherwise, set it to false.

2.  **Analyze and Assess Risk (riskScore and riskFactors fields):**
    *   Based on ALL the information, generate a risk score between 0 and 100 (0=lowest risk, 100=highest risk). For this task, you can provide a neutral score around 50.
    *   In the 'riskFactors' field, provide a simple bullet-point summary of a few key factors.

3.  **Recommend Action (recommendedAction field):**
    *   Based on your analysis, recommend an action: "Aprobar", "Rechazar", or "Solicitar más información".
    *   Your final response and all summaries must be in Spanish.`,
});

const assessLoanRiskFlow = ai.defineFlow(
  {
    name: 'assessLoanRiskFlow',
    inputSchema: AssessLoanRiskInputSchema,
    outputSchema: AssessLoanRiskOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
