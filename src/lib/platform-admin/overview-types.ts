export type PlatformOverview = {
 actorUserId:string; generatedAt:string;
 companies: {total:string;active:string;suspended:string};
 users: {total:string;verified:string;activeMemberships:string};
 applications: {total:string;new:string;inReview:string;contacted:string;closed:string;legacyIncomplete:string};
 inventory: {total:string;available:string;reserved:string;sold:string;archived:string};
 deals: {total:string;draft:string;reserved:string;cancelled:string;completed:string};
 offers: {customerReviews:string;accepted:string;declined:string;versions:string};
 advertising: {draft:string;ready:string;connectionsRequested:string;connectionsVerified:string};
 financing: {intakeRequests:string};
 stockAskingPriceOre:string; daily:{date:string;applications:string;companies:string;deals:string}[];
};
export type PlatformOverviewResult = {ok:true;overview:PlatformOverview}|{ok:false;code:"access_denied"|"invalid_input"|"unavailable";message:string};
