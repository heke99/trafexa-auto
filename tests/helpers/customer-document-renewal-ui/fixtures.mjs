export const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const props={companyId:id(1),dealId:id(2),referenceId:id(3),kind:'contract_invitation',userId:id(4),role:'owner'};
export const firstAck='Jag har granskat mottagaren och dokumentversionen och förstår att den tidigare dokumentlänken blir ogiltig.';
export const secondAck='Jag vill skapa en ny personlig dokumentlänk och ett nytt mejl till den sparade mottagaren.';
export function lifecycle(overrides={}){return{companyId:props.companyId,dealId:props.dealId,referenceId:props.referenceId,kind:props.kind,actorUserId:props.userId,actorRole:props.role,recipientEmail:'anna@example.invalid',documentHash:'a'.repeat(64),documentVersion:3,emailId:id(5),invitationId:id(6),generation:0,expiresAt:'2026-10-17T10:00:00Z',revoked:false,linkStatus:'expired',status:'accepted',canRenew:true,blockedReason:null,reviewToken:'b'.repeat(64),transport:'configured',...overrides};}
