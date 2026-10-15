export async function getPlatformOverviewAction(input) {
 window.fixture.overviewCalls.push(input);
 const response=window.fixture.overviewResponses.shift();
 if(response?.throw) throw new Error('Fixture transport error');
 if(response) return response;
 return {ok:true,overview:{actorUserId:'30000000-0000-4000-8000-000000000001',generatedAt:'2026-10-14T12:00:00Z',companies:{total:'12',active:'10',suspended:'2'},users:{total:'32',verified:'30',activeMemberships:'45'},applications:{total:'20',new:'8',inReview:'4',contacted:'6',closed:'2',legacyIncomplete:'1'},inventory:{total:'99',available:'80',reserved:'4',sold:'10',archived:'5'},deals:{total:'14',draft:'8',reserved:'4',cancelled:'2',completed:'0'},offers:{versions:'22',customerReviews:'10',accepted:'6',declined:'2'},advertising:{draft:'18',ready:'4',connectionsRequested:'2',connectionsVerified:'0'},financing:{intakeRequests:'3'},stockAskingPriceOre:'9007199254740993',daily:Array.from({length:7},(_,i)=>({date:`2026-10-${String(i+8).padStart(2,'0')}`,applications:String(i),companies:String(i%3),deals:String(i%2)}))}};
}
