import{z}from'zod';
const uuid=z.string().uuid();
const vehicle=z.object({make:z.string().max(500),model:z.string().max(500),year:z.number().int().min(1900).max(2100),mileageKm:z.number().int().nonnegative(),fuel:z.string(),gearbox:z.string(),priceOre:z.string().regex(/^\d{1,19}$/),currency:z.literal('SEK'),seller:z.string().max(500)});
export const networkPageSchema=z.object({companyId:uuid,actorId:uuid,role:z.enum(['owner','admin','sales','finance','viewer']),hasMore:z.boolean(),hasMoreOwn:z.boolean().optional().default(false),hasMoreThreads:z.boolean().optional().default(false),
 items:z.array(z.object({id:uuid,version:z.number().int().positive(),vehicle})).max(50),
 own:z.array(z.object({stockId:uuid,title:z.string(),registration:z.string(),status:z.string(),listingId:uuid.nullable(),version:z.number().int().nonnegative(),published:z.boolean(),live:z.boolean(),source:vehicle.nullable()})).max(50),
 threads:z.array(z.object({id:uuid,title:z.string(),direction:z.enum(['sent','received']),counterparty:z.string(),senderEmail:z.string().email(),hasOlderMessages:z.boolean(),messages:z.array(z.object({id:uuid,own:z.boolean(),text:z.string().max(2000),createdAt:z.string().datetime({offset:true})})).max(100)})).max(50)
});

export const networkMoreSchema=networkPageSchema.omit({items:true,hasMoreOwn:true,hasMoreThreads:true}).extend({kind:z.enum(['own','threads','messages']),inquiryId:uuid.nullable(),messages:z.array(z.object({id:uuid,own:z.boolean(),text:z.string().max(2000),createdAt:z.string().datetime({offset:true})})).max(50),own:networkPageSchema.shape.own.max(50),threads:networkPageSchema.shape.threads.max(50)});
