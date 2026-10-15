export async function listCompanyTeamAction(input) { window.fixture.teamCalls = (window.fixture.teamCalls ?? 0) + 1; const p=window.fixture.page; return {ok:true,companyId:input.companyId,actorUserId:p.actorUserId,actorRole:p.actorRole,teamVersion:p.teamVersion,members:[],invitations:[],nextMembersPageKey:null,nextInvitationsPageKey:null}; }
export async function cancelCompanyInvitationAction(){throw Error('Unused');}
export async function inviteCompanyMemberAction(){throw Error('Unused');}
export async function updateCompanyMemberAction(){throw Error('Unused');}
