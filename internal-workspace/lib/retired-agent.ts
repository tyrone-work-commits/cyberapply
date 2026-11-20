/** The former local worker must never claim a job or read a CV again. */
export function retiredAgentResponse(): Response {
  return Response.json(
    {error:'The previous local application agent has been removed. No automatic submission is connected.'},
    {status:410,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}},
  );
}
